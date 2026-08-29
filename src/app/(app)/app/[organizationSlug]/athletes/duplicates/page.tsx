import { notFound } from 'next/navigation';

import type { Json } from '@/infrastructure/supabase/database.types';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

function duplicateRows(value: Json) {
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
      Array.isArray(item.athlete)
    )
      return [];
    const givenName = typeof item.athlete.givenName === 'string' ? item.athlete.givenName : '';
    const familyName = typeof item.athlete.familyName === 'string' ? item.athlete.familyName : '';
    return [{ row: item.row, name: `${givenName} ${familyName}`.trim() }];
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
      .order('created_at', { ascending: false })
      .limit(20),
    current.client
      .from('registration_duplicate_candidates')
      .select('id,registration_id,candidate_athlete_id,reason,created_at')
      .eq('organization_id', current.organization.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);
  const imported = (imports.data ?? []).flatMap((preview) =>
    duplicateRows(preview.preview_rows).map((row) => ({
      ...row,
      id: `${preview.id}:${row.row}`,
      createdAt: preview.created_at,
    })),
  );
  return (
    <section aria-labelledby="duplicates-heading">
      <p className="eyebrow">Athlete directory</p>
      <h2 id="duplicates-heading">Potential duplicates</h2>
      <p className="text-[var(--color-text-muted)]">
        Candidates are review signals only. TryoutFlow never merges athlete records automatically.
      </p>
      <h3 className="mt-6">CSV preview candidates</h3>
      <ul className="mt-3 space-y-2">
        {imported.map((candidate) => (
          <li
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            key={candidate.id}
          >
            <span className="font-bold">{candidate.name || `CSV row ${candidate.row}`}</span>
            <span className="block text-sm text-[var(--color-text-muted)]">
              Row {candidate.row} · {new Date(candidate.createdAt).toLocaleDateString('en-CA')}
            </span>
          </li>
        ))}
      </ul>
      {imported.length === 0 ? (
        <p className="mt-3 text-[var(--color-text-muted)]">No CSV duplicate candidates.</p>
      ) : null}
      <h3 className="mt-8">Registration candidates</h3>
      <ul className="mt-3 space-y-2">
        {(registrations.data ?? []).map((candidate) => (
          <li
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            key={candidate.id}
          >
            <span className="font-bold">Registration review required</span>
            <span className="block text-sm text-[var(--color-text-muted)]">
              Reason: {candidate.reason.replaceAll('_', ' ')}
            </span>
          </li>
        ))}
      </ul>
      {registrations.data?.length === 0 ? (
        <p className="mt-3 text-[var(--color-text-muted)]">No registration duplicate candidates.</p>
      ) : null}
    </section>
  );
}
