import Link from 'next/link';
import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import { redirect } from 'next/navigation';

import { ErrorState } from '@/components/feedback/error-state';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTryout } from '@/modules/tryouts/application/create-tryout';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { PageHeader } from '@/components/layout/page-header';

export default async function NewTryoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { organizationSlug } = await params;
  const query = (await searchParams) ?? {};
  const current = await requireCurrentOrganization(organizationSlug);
  const seasonsResult = await current.client
    .from('seasons')
    .select('id,name')
    .eq('organization_id', current.organization.id)
    .order('name');
  if (seasonsResult.error) {
    captureOperationalError(seasonsResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'tryouts.load',
    });
    return (
      <ErrorState
        action={
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/new`}
            prefetch={false}
          >
            Retry cycles
          </Link>
        }
        description="Available cycles could not be loaded. No draft was created."
        title="Tryout setup temporarily unavailable"
      />
    );
  }
  const seasons = seasonsResult.data ?? [];
  const defaultsUpgrade = await billingUpgradePrompt(
    current.organization.id,
    organizationSlug,
    'organization_management',
  );
  const defaultSport = defaultsUpgrade ? '' : (current.organization.sportDefaults[0] ?? '');
  async function create(formData: FormData) {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const result = await createTryout(
      {
        organizationId: route.organization.id,
        seasonId: formData.get('seasonId') || undefined,
        newSeasonName: formData.get('newSeasonName') || undefined,
        name: formData.get('name'),
        sport: formData.get('sport'),
        timezone: formData.get('timezone'),
        registrationStartsAt: formData.get('registrationStartsAt') || undefined,
        registrationEndsAt: formData.get('registrationEndsAt') || undefined,
      },
      { authorization: route.authorization },
    );
    if (!result.ok) redirect(`/app/${organizationSlug}/tryouts/new?error=${result.error.code}`);
    await trackSupabaseWorkflowSafely(route.client, {
      name: 'workflow.completed',
      workflow: 'tryout_setup',
      organizationId: route.organization.id,
      correlationId: createCorrelationId(),
    });
    redirect(`/app/${organizationSlug}/tryouts/${result.value.id}/setup/basics`);
  }
  const errorMessage =
    query.error === 'slug_conflict'
      ? 'A tryout with that name already exists. Choose a different name.'
      : query.error === 'invalid_time_range'
        ? 'Registration close time must be after the open time.'
        : query.error === 'invalid_input'
          ? 'Enter a tryout name, sport, and exactly one cycle before creating the draft.'
          : query.error
            ? 'We could not create the tryout. Please try again.'
            : undefined;
  return (
    <section aria-labelledby="new-tryout-heading" className="workspace-stack">
      <PageHeader
        description="Create a draft, then configure registration, evaluations, staff, and publishing from the tryout workspace."
        eyebrow="Tryout setup"
        title="Create a tryout"
      />
      {errorMessage ? (
        <p className="auth-alert" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <form action={create} className="workspace-card grid gap-5">
        <div>
          <p className="eyebrow">Basics</p>
          <h2 id="new-tryout-heading" className="workspace-card-title">
            Start with the essentials
          </h2>
          <p>
            Name your event, choose its sport, and set the registration window. You can finish the
            rest after creating the draft.
          </p>
        </div>
        <label className="block" htmlFor="name">
          <span className="font-bold">Tryout name</span>
          <Input id="name" name="name" placeholder={FIELD_EXAMPLES.tryoutName} required />
        </label>
        <label className="block" htmlFor="sport">
          <span className="font-bold">Sport</span>
          <Input
            defaultValue={defaultSport}
            id="sport"
            name="sport"
            placeholder={defaultSport ? undefined : FIELD_EXAMPLES.sport}
            required
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="font-bold">Cycle or season</legend>
          <label className="block" htmlFor="seasonId">
            <span>Use an existing cycle</span>
            <select
              className="min-h-11 w-full rounded border px-3"
              defaultValue={seasons[0]?.id ?? ''}
              id="seasonId"
              name="seasonId"
            >
              <option value="">Create a new cycle</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block" htmlFor="newSeasonName">
            <span>New cycle name</span>
            <Input
              id="newSeasonName"
              maxLength={120}
              name="newSeasonName"
              defaultValue={seasons.length ? undefined : `Fall ${new Date().getFullYear()}`}
              placeholder={FIELD_EXAMPLES.season}
            />
          </label>
          <p className="text-sm text-[var(--color-text-muted)]">
            Choose an existing cycle, or leave it on “Create a new cycle” and enter a new name.
          </p>
        </fieldset>
        <label className="block" htmlFor="timezone">
          <span className="font-bold">Timezone</span>
          <Input
            aria-describedby="new-tryout-timezone-help"
            defaultValue={current.organization.timezone}
            id="timezone"
            name="timezone"
            required
          />
          <span
            className="mt-1 block text-sm text-[var(--color-text-muted)]"
            id="new-tryout-timezone-help"
          >
            Times use the IANA timezone shown here. Example: {FIELD_EXAMPLES.timezone}.
          </span>
        </label>
        <div className="rounded-lg bg-[var(--color-surface-muted)] p-3">
          <h3>Registration window</h3>
          <p>
            These dates control when athletes can register. Set the actual tryout event dates in
            Sessions after creating the draft.
          </p>
        </div>
        <label className="block" htmlFor="registrationStartsAt">
          <span className="font-bold">Registration opens</span>
          <Input
            aria-describedby="new-tryout-registration-opens-help"
            id="registrationStartsAt"
            name="registrationStartsAt"
            type="datetime-local"
          />
          <span
            className="mt-1 block text-sm text-[var(--color-text-muted)]"
            id="new-tryout-registration-opens-help"
          >
            Example: September 15, 2026 at 6:00 PM in {current.organization.timezone}.
          </span>
        </label>
        <label className="block" htmlFor="registrationEndsAt">
          <span className="font-bold">Registration closes</span>
          <Input
            aria-describedby="new-tryout-registration-closes-help"
            id="registrationEndsAt"
            name="registrationEndsAt"
            type="datetime-local"
          />
          <span
            className="mt-1 block text-sm text-[var(--color-text-muted)]"
            id="new-tryout-registration-closes-help"
          >
            Example: September 30, 2026 at 6:00 PM in {current.organization.timezone}.
          </span>
        </label>
        <Button type="submit">Create draft</Button>
      </form>
    </section>
  );
}
