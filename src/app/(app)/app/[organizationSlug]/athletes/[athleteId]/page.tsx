import { notFound } from 'next/navigation';

import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function AthleteDetailPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; athleteId: string }>;
}) {
  const { organizationSlug, athleteId } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'athlete:read', {
      organizationId: current.organization.id,
      athleteId,
    }).ok
  )
    notFound();
  const result = await current.client
    .from('athletes')
    .select('id,given_name,family_name,birth_date,created_at')
    .eq('organization_id', current.organization.id)
    .eq('id', athleteId)
    .maybeSingle();
  if (result.error || !result.data) notFound();
  const athlete = result.data;
  return (
    <section aria-labelledby="athlete-heading" className="max-w-2xl">
      <p className="eyebrow">Athlete record</p>
      <h2 id="athlete-heading">
        {athlete.given_name} {athlete.family_name}
      </h2>
      <dl className="mt-6 grid gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-bold text-[var(--color-text-muted)]">Birth date</dt>
          <dd>{athlete.birth_date}</dd>
        </div>
        <div>
          <dt className="text-sm font-bold text-[var(--color-text-muted)]">Added</dt>
          <dd>{new Date(athlete.created_at).toLocaleDateString('en-CA')}</dd>
        </div>
      </dl>
    </section>
  );
}
