import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Json } from '@/infrastructure/supabase/database.types';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { DuplicateReviewAction } from '@/modules/registration/ui/duplicate-review-action';

type PreviewCandidate = {
  row: number;
  name: string;
  birthDate: string;
  guardianEmail?: string;
  candidateIds: string[];
};

function duplicateRows(value: Json): PreviewCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      item.status !== 'duplicate_candidate' ||
      typeof item.row !== 'number' ||
      !item.athlete ||
      typeof item.athlete !== 'object' ||
      Array.isArray(item.athlete) ||
      !Array.isArray(item.duplicateCandidateIds)
    )
      return [];
    const givenName = typeof item.athlete.givenName === 'string' ? item.athlete.givenName : '';
    const familyName = typeof item.athlete.familyName === 'string' ? item.athlete.familyName : '';
    return [
      {
        row: item.row,
        name: `${givenName} ${familyName}`.trim(),
        birthDate: typeof item.athlete.birthDate === 'string' ? item.athlete.birthDate : '',
        ...(typeof item.athlete.guardianEmail === 'string'
          ? { guardianEmail: item.athlete.guardianEmail }
          : {}),
        candidateIds: item.duplicateCandidateIds.filter(
          (id): id is string => typeof id === 'string',
        ),
      },
    ];
  });
}

export default async function DuplicateReviewPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'athlete:write', {
      organizationId: current.organization.id,
    }).ok ||
    !['owner', 'administrator'].includes(current.authorization.organizationRole)
  )
    notFound();

  const [imports, registrations] = await Promise.all([
    current.client
      .from('athlete_import_previews')
      .select('id,preview_rows,created_at,expires_at')
      .eq('organization_id', current.organization.id)
      .eq('actor_user_id', current.authorization.userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(50),
    current.client
      .from('registration_duplicate_candidates')
      .select('id,registration_id,candidate_athlete_id,reason,created_at,resolution')
      .eq('organization_id', current.organization.id)
      .is('resolution', null)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);
  const imported = (imports.data ?? []).flatMap((preview) =>
    duplicateRows(preview.preview_rows).map((row) => ({
      ...row,
      previewId: preview.id,
      createdAt: preview.created_at,
    })),
  );
  const candidateAthleteIds = [
    ...new Set([
      ...imported.flatMap((candidate) =>
        candidate.candidateIds.filter((id) => /^[0-9a-f-]{36}$/iu.test(id)),
      ),
      ...(registrations.data ?? []).map((candidate) => candidate.candidate_athlete_id),
    ]),
  ];
  const registrationIds = (registrations.data ?? []).map((candidate) => candidate.registration_id);
  const [athleteResult, registrationResult] = await Promise.all([
    candidateAthleteIds.length
      ? current.client
          .from('athletes')
          .select('id,given_name,family_name,birth_date')
          .eq('organization_id', current.organization.id)
          .in('id', candidateAthleteIds)
      : Promise.resolve({ data: [], error: null }),
    registrationIds.length
      ? current.client
          .from('tryout_registrations')
          .select('id,athlete_id,tryout_id,status')
          .eq('organization_id', current.organization.id)
          .in('id', registrationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const registeredAthleteIds = (registrationResult.data ?? []).map(
    (registration) => registration.athlete_id,
  );
  const registeredAthletes = registeredAthleteIds.length
    ? await current.client
        .from('athletes')
        .select('id,given_name,family_name,birth_date')
        .eq('organization_id', current.organization.id)
        .in('id', registeredAthleteIds)
    : { data: [], error: null };
  const athletesById = new Map(
    [...(athleteResult.data ?? []), ...(registeredAthletes.data ?? [])].map((athlete) => [
      athlete.id,
      athlete,
    ]),
  );
  const registrationsById = new Map(
    (registrationResult.data ?? []).map((registration) => [registration.id, registration]),
  );
  const queryFailed = Boolean(
    imports.error ||
    registrations.error ||
    athleteResult.error ||
    registrationResult.error ||
    registeredAthletes.error,
  );

  return (
    <section aria-labelledby="duplicates-heading">
      <p className="eyebrow">Athlete directory</p>
      <h2 id="duplicates-heading">Potential duplicates</h2>
      <p className="text-[var(--color-text-muted)]">
        Compare both records before deciding. TryoutFlow never merges athlete records automatically.
      </p>
      {queryFailed ? (
        <div className="mt-4 rounded-lg border border-[var(--color-danger)] p-4" role="alert">
          Duplicate candidates could not be loaded completely. Refresh to try again.
        </div>
      ) : null}

      <h3 className="mt-6">CSV preview candidates</h3>
      <ul className="mt-3 space-y-3">
        {imported.map((candidate) => (
          <li
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            key={`${candidate.previewId}:${candidate.row}`}
          >
            <p className="font-bold">Incoming: {candidate.name || `CSV row ${candidate.row}`}</p>
            <p className="text-sm">
              Born {candidate.birthDate}
              {candidate.guardianEmail ? ` · Guardian ${candidate.guardianEmail}` : ''}
            </p>
            <div className="mt-3 border-l-4 border-[var(--color-border)] pl-3">
              <p className="font-bold">Existing candidate(s)</p>
              {candidate.candidateIds.map((id) => {
                const athlete = athletesById.get(id);
                return athlete ? (
                  <Link
                    className="block text-[var(--color-primary)] underline"
                    href={`/app/${organizationSlug}/athletes/${athlete.id}`}
                    key={id}
                  >
                    {athlete.given_name} {athlete.family_name} · born {athlete.birth_date}
                  </Link>
                ) : (
                  <span className="block text-sm" key={id}>
                    {id.startsWith('preview-row:')
                      ? `CSV ${id.replace('preview-row:', 'row ')}`
                      : 'Candidate record unavailable'}
                  </span>
                );
              })}
            </div>
            <DuplicateReviewAction
              organizationId={current.organization.id}
              payload={{
                action: 'resolve_import_duplicate',
                previewId: candidate.previewId,
                row: candidate.row,
              }}
              label="Confirm these are separate athletes"
            />
          </li>
        ))}
      </ul>
      {imported.length === 0 ? (
        <p className="mt-3 text-[var(--color-text-muted)]">No active CSV duplicate candidates.</p>
      ) : null}

      <h3 className="mt-8">Registration candidates</h3>
      <ul className="mt-3 space-y-3">
        {(registrations.data ?? []).map((candidate) => {
          const registration = registrationsById.get(candidate.registration_id);
          const incoming = registration ? athletesById.get(registration.athlete_id) : undefined;
          const existing = athletesById.get(candidate.candidate_athlete_id);
          return (
            <li
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              key={candidate.id}
            >
              <p className="font-bold">
                Registration athlete:{' '}
                {incoming
                  ? `${incoming.given_name} ${incoming.family_name} · born ${incoming.birth_date}`
                  : 'Unavailable'}
              </p>
              <p className="mt-2">
                Existing candidate:{' '}
                {existing ? (
                  <Link
                    className="text-[var(--color-primary)] underline"
                    href={`/app/${organizationSlug}/athletes/${existing.id}`}
                  >
                    {existing.given_name} {existing.family_name} · born {existing.birth_date}
                  </Link>
                ) : (
                  'Unavailable'
                )}
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Reason: {candidate.reason.replaceAll('_', ' ')}
              </p>
              <div className="flex flex-wrap gap-2">
                <DuplicateReviewAction
                  organizationId={current.organization.id}
                  payload={{
                    action: 'resolve_registration_duplicate',
                    candidateId: candidate.id,
                    decision: 'keep_separate',
                  }}
                  label="Keep separate"
                />
                <DuplicateReviewAction
                  organizationId={current.organization.id}
                  payload={{
                    action: 'resolve_registration_duplicate',
                    candidateId: candidate.id,
                    decision: 'dismiss_candidate',
                  }}
                  label="Dismiss candidate"
                />
              </div>
            </li>
          );
        })}
      </ul>
      {registrations.data?.length === 0 ? (
        <p className="mt-3 text-[var(--color-text-muted)]">No registration duplicate candidates.</p>
      ) : null}
    </section>
  );
}
