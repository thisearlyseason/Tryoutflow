import { notFound } from 'next/navigation';

import { RegistrationShare } from '@/modules/tryouts/ui/registration-share';
import { getPublicAppOrigin } from '@/lib/env';
import {
  canManageTryoutStaffing,
  requireOrganizationRouteContext,
} from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import Link from 'next/link';

export default async function TryoutOverviewPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:read', {
      organizationId: current.organization.id,
      tryoutId,
    }).ok
  )
    notFound();
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
      {canManageTryoutStaffing(current.authorization, tryoutId) ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/staff`}
          >
            Manage staff
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/live`}
          >
            Live dashboard
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/rankings`}
          >
            Rankings
          </Link>
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/rosters`}
          >
            Rosters
          </Link>
        </div>
      ) : null}
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
