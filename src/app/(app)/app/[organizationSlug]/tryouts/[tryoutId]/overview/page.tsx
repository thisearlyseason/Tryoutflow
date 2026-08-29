import { notFound } from 'next/navigation';

import { RegistrationShare } from '@/modules/tryouts/ui/registration-share';
import { getPublicAppOrigin } from '@/lib/env';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function TryoutOverviewPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const { data: tryout } = await current.client
    .from('tryouts')
    .select('id, name, slug, status')
    .eq('organization_id', current.organization.id)
    .eq('id', tryoutId)
    .maybeSingle();
  if (!tryout) notFound();
  return (
    <section aria-labelledby="tryout-overview-heading">
      <p className="eyebrow">{tryout.status}</p>
      <h2 id="tryout-overview-heading">{tryout.name}</h2>
      {tryout.status === 'published' ? (
        <div className="mt-6">
          <RegistrationShare origin={getPublicAppOrigin()} publicSlug={tryout.slug} />
        </div>
      ) : (
        <p className="mt-4 text-[var(--color-text-muted)]">
          Finish guided setup before this tryout can be shared.
        </p>
      )}
    </section>
  );
}
