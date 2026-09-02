import { randomUUID } from 'node:crypto';

import QRCode from 'qrcode';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { Input } from '@/components/ui/input';
import { getPublicAppOrigin } from '@/lib/env';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { issueCheckinQr } from '@/modules/checkin/application/issue-checkin-qr';
import { IssueQrButton, type QrState } from '@/modules/checkin/ui/issue-qr-button';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';
import { createStaffRegistration } from '@/modules/registration/application/create-staff-registration';
import { RegistrationFormSchema } from '@/modules/registration/domain/form-schema';
import { ParticipantWorkspaceHeader } from '@/modules/registration/ui/participant-workspace-header';
import { TryoutJourneyNavigation } from '@/modules/tryouts/ui/tryout-journey';

const configurationSchema = z.object({
  tryout_name: z.string(),
  tryout_status: z.string(),
  divisions: z.array(z.object({ id: z.uuid(), name: z.string() })),
  positions: z.array(z.object({ id: z.uuid(), name: z.string() })),
  form_schema: RegistrationFormSchema,
});

export default async function TryoutRegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
  searchParams: Promise<{ created?: string; error?: string; q?: string }>;
}) {
  const [{ organizationSlug, tryoutId }, query] = await Promise.all([params, searchParams]);
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:write', {
      organizationId: current.organization.id,
      tryoutId,
    }).ok
  )
    return (
      <section aria-labelledby="registration-denied">
        <h2 id="registration-denied">Registration workspace unavailable</h2>
        <p role="alert">You do not have access to manage registrations for this tryout.</p>
      </section>
    );

  const journeyNavigation = (
    <TryoutJourneyNavigation
      nextAction={{
        label: 'Review sessions',
        href: `/app/${organizationSlug}/tryouts/${tryoutId}/sessions`,
      }}
      overviewHref={`/app/${organizationSlug}/tryouts/${tryoutId}/overview`}
    />
  );

  const configurationResult = await current.client.rpc('load_staff_registration_configuration', {
    p_organization_id: current.organization.id,
    p_tryout_id: tryoutId,
  });
  const parsedConfiguration = configurationSchema.safeParse(configurationResult.data?.[0]);
  if (configurationResult.error) {
    captureOperationalError(configurationResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'registration.load',
    });
    return (
      <section aria-labelledby="registration-unavailable">
        {journeyNavigation}
        <h2 id="registration-unavailable">Registration workspace unavailable</h2>
        <p role="alert">Configuration could not be loaded. Refresh or try again shortly.</p>
      </section>
    );
  }
  if (!parsedConfiguration.success)
    return (
      <section aria-labelledby="registration-not-found">
        {journeyNavigation}
        <h2 id="registration-not-found">Tryout registration not found</h2>
        <p>The tryout may have been removed or is outside your assigned scope.</p>
      </section>
    );
  const configuration = parsedConfiguration.data;
  const athleteQuery = typeof query.q === 'string' ? query.q.trim() : '';
  const returningResult =
    athleteQuery.length >= 2 && athleteQuery.length <= 80
      ? await current.client.rpc('list_returning_athletes', {
          p_organization_id: current.organization.id,
          p_tryout_id: tryoutId,
          p_query: athleteQuery,
          p_limit: 20,
        })
      : { data: [], error: null };
  const registrationsResult = await current.client
    .from('tryout_registrations')
    .select('id,status,athletes!inner(given_name,family_name)', { count: 'exact' })
    .eq('organization_id', current.organization.id)
    .eq('tryout_id', tryoutId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (returningResult.error)
    captureOperationalError(returningResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'registration.load',
    });
  if (registrationsResult.error)
    captureOperationalError(registrationsResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'registration.load',
    });

  async function createRegistration(formData: FormData) {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const existingAthleteId = String(formData.get('existingAthleteId') ?? '').trim();
    const responses = Object.fromEntries(
      configuration.form_schema.fields.map((field) => {
        const value = formData.get(`response.${field.key}`);
        return [
          field.key,
          field.kind === 'checkbox' || field.kind === 'consent' ? value === 'on' : value,
        ];
      }),
    );
    const result = await createStaffRegistration(
      {
        organizationId: route.organization.id,
        tryoutId,
        existingAthleteId: existingAthleteId || undefined,
        divisionId: formData.get('divisionId'),
        positionId: formData.get('positionId') || undefined,
        givenName: existingAthleteId ? undefined : formData.get('givenName'),
        familyName: existingAthleteId ? undefined : formData.get('familyName'),
        birthDate: existingAthleteId ? undefined : formData.get('birthDate'),
        responses,
        idempotencyKey: formData.get('idempotencyKey'),
      },
      { authorization: route.authorization },
      { form: configuration.form_schema },
    );
    if (!result.ok)
      redirect(
        `/app/${organizationSlug}/tryouts/${tryoutId}/registration?error=${result.error.code}`,
      );
    await trackSupabaseWorkflowSafely(route.client, {
      name: 'workflow.completed',
      workflow: 'registration',
      organizationId: route.organization.id,
      correlationId: createCorrelationId(),
    });
    redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/registration?created=1`);
  }

  async function issueQr(_previous: QrState, formData: FormData): Promise<QrState> {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const result = await issueCheckinQr(
      {
        organizationId: route.organization.id,
        tryoutId,
        registrationId: formData.get('registrationId'),
      },
      { authorization: route.authorization },
    );
    if (!result.ok)
      return {
        status: 'error',
        message: 'A QR code could not be issued. Publish the tryout and retry.',
      };
    const lookupPath = `/app/${organizationSlug}/tryouts/${tryoutId}/check-in?qr=${result.value.token}`;
    return {
      status: 'issued',
      lookupUrl: lookupPath,
      qrDataUrl: await QRCode.toDataURL(new URL(lookupPath, getPublicAppOrigin()).toString(), {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 360,
      }),
    };
  }

  return (
    <section aria-label="Participant workspace" className="grid gap-8">
      <div>
        <ParticipantWorkspaceHeader
          importHref={`/app/${organizationSlug}/athletes/import`}
          overviewHref={`/app/${organizationSlug}/tryouts/${tryoutId}/overview#registration-share`}
          participantCount={
            registrationsResult.error
              ? null
              : (registrationsResult.count ?? registrationsResult.data?.length ?? 0)
          }
          tryoutName={configuration.tryout_name}
        />
        {query.created === '1' ? <p role="status">Registration created.</p> : null}
        {query.error === 'idempotency_conflict' ? (
          <p role="alert">
            Registration was not created because this request key is already bound to different
            content. Review the athlete and form details, then restart the registration.
          </p>
        ) : query.error ? (
          <p role="alert">Registration could not be created. Review the fields and try again.</p>
        ) : null}
      </div>

      <section aria-labelledby="returning-heading" className="card p-5" id="returning-participant">
        <h3 id="returning-heading">Find a returning athlete</h3>
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" method="get">
          <label className="grow" htmlFor="returning-query">
            Athlete name
            <Input
              defaultValue={athleteQuery}
              id="returning-query"
              maxLength={80}
              minLength={2}
              name="q"
              placeholder={`${FIELD_EXAMPLES.athleteGivenName} ${FIELD_EXAMPLES.athleteFamilyName}`}
            />
          </label>
          <Button type="submit">Search athletes</Button>
        </form>
        {returningResult.error ? (
          <p role="alert">Athlete lookup is temporarily unavailable.</p>
        ) : athleteQuery && returningResult.data?.length === 0 ? (
          <p role="status">No matching organization athletes.</p>
        ) : null}
      </section>

      <section aria-labelledby="manual-heading" className="card p-5" id="add-participant">
        <h3 id="manual-heading">Add a new participant</h3>
        <form action={createRegistration} className="mt-4 grid gap-4">
          <input name="idempotencyKey" type="hidden" value={randomUUID()} />
          <label>
            Returning athlete (optional)
            <select className="min-h-11 w-full rounded border px-3" name="existingAthleteId">
              <option value="">Create a new athlete record</option>
              {(returningResult.data ?? []).map((athlete) => (
                <option key={athlete.athlete_id} value={athlete.athlete_id}>
                  {athlete.given_name} {athlete.family_name} — {athlete.birth_date}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              New athlete first name
              <Input
                maxLength={120}
                name="givenName"
                placeholder={FIELD_EXAMPLES.athleteGivenName}
              />
            </label>
            <label>
              New athlete last name
              <Input
                maxLength={120}
                name="familyName"
                placeholder={FIELD_EXAMPLES.athleteFamilyName}
              />
            </label>
          </div>
          <label>
            New athlete date of birth
            <Input
              aria-describedby="staff-registration-birth-date-help"
              name="birthDate"
              type="date"
            />
            <span
              className="mt-1 block text-sm text-[var(--color-text-muted)]"
              id="staff-registration-birth-date-help"
            >
              Example: September 15, 2012.
            </span>
          </label>
          <label>
            Division
            <select
              className="min-h-11 w-full rounded border px-3"
              defaultValue=""
              name="divisionId"
              required
            >
              <option disabled value="">
                Select a division
              </option>
              {configuration.divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Position (optional)
            <select className="min-h-11 w-full rounded border px-3" name="positionId">
              <option value="">Unassigned</option>
              {configuration.positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </label>
          {configuration.form_schema.fields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.kind === 'checkbox' || field.kind === 'consent' ? (
                <input name={`response.${field.key}`} required={field.required} type="checkbox" />
              ) : field.kind === 'select' ? (
                <select
                  className="min-h-11 w-full rounded border px-3"
                  defaultValue=""
                  name={`response.${field.key}`}
                  required={field.required}
                >
                  <option disabled={field.required} value="">
                    Select {field.label.toLowerCase()}
                  </option>
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <Input
                  aria-describedby={
                    field.kind === 'date'
                      ? `staff-registration-response-${field.key}-help`
                      : undefined
                  }
                  name={`response.${field.key}`}
                  required={field.required}
                  type={field.kind === 'date' ? 'date' : field.kind === 'email' ? 'email' : 'text'}
                />
              )}
              {field.kind === 'date' ? (
                <span
                  className="mt-1 block text-sm text-[var(--color-text-muted)]"
                  id={`staff-registration-response-${field.key}-help`}
                >
                  {field.helpText ? `${field.helpText} ` : null}Example: September 15, 2012.
                </span>
              ) : null}
            </label>
          ))}
          <Button type="submit">Create registration</Button>
        </form>
      </section>

      <section aria-labelledby="registered-heading">
        <h3 id="registered-heading">Recent registrations</h3>
        {registrationsResult.error ? (
          <p role="alert">Registrations are temporarily unavailable.</p>
        ) : registrationsResult.data?.length ? (
          <ul className="mt-3 grid gap-3">
            {registrationsResult.data.map((registration) => (
              <li className="card grid gap-3 p-4" key={registration.id}>
                <p className="font-bold">
                  {registration.athletes.given_name} {registration.athletes.family_name}
                </p>
                <p>Status: {registration.status}</p>
                <IssueQrButton action={issueQr} registrationId={registration.id} />
              </li>
            ))}
          </ul>
        ) : (
          <p role="status">No registrations yet.</p>
        )}
      </section>
    </section>
  );
}
