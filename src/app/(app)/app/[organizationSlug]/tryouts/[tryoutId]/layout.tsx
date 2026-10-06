import { loadSingleTryoutLifecycle } from '@/modules/tryouts/application/single-tryout-lifecycle';
import { SingleTryoutNotice } from '@/modules/tryouts/ui/single-tryout-notice';
import { EventNavigation } from '@/modules/talent/ui/event-navigation';
import type { ReactNode } from 'react';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug: slug, tryoutId } = await params;
  const c = await requireCurrentOrganization(slug);
  const manager = ['owner', 'administrator'].includes(c.authorization.organizationRole);
  const roles = c.authorization.assignments
    .filter((a) => a.scope.tryoutId === tryoutId)
    .map((a) => a.role);
  const director = manager || roles.includes('director');
  const review = director || roles.includes('reviewer');
  const lifecycle =
    manager || roles.length > 0
      ? await loadSingleTryoutLifecycle(c.client, c.organization.id, tryoutId)
      : null;
  const links = [
    ...(manager
      ? [
          ['overview', 'Overview'],
          ['registration', 'Registration'],
          ['eligibility', 'Eligibility'],
          ['stations', 'Stations'],
          ['scenarios', 'Scenarios'],
        ]
      : []),
    ...(director
      ? [
          ['live', 'Live'],
          ['coverage', 'Coverage'],
          ['staff', 'Staff'],
        ]
      : []),
    ...(director || roles.includes('checkin') ? [['check-in', 'Check-in']] : []),
    ...(review
      ? [
          ['rankings', 'Rankings'],
          ['rosters', 'Rosters'],
          ['reports', 'Reports'],
        ]
      : []),
    ...(manager
      ? [
          ['operations', 'Notices & fees'],
          ['messages', 'Decision messages'],
        ]
      : []),
  ];
  return (
    <div className="talent-stack">
      {links.length > 0 && (
        <EventNavigation base={`/app/${slug}/tryouts/${tryoutId}`} links={links} />
      )}
      {lifecycle ? <SingleTryoutNotice lifecycle={lifecycle} /> : null}
      {children}
    </div>
  );
}
