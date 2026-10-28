import { eventNavigationOptions } from '@/modules/organizations/application/event-navigation-options';
import { PrivateSessionBoundary } from '@/modules/identity/ui/private-session-boundary';
import { loadWorkspaceNavigation } from '@/modules/organizations/application/team-workspaces';
import { WorkspaceSwitcher } from '@/modules/organizations/components/workspace-switcher';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import {
  buildAppNavigation,
  describeAppRole,
} from '@/modules/organizations/components/app-navigation-model';

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const { organization, authorization, client, userId } =
    await requireOrganizationRouteContext(organizationSlug);
  const manager = ['owner', 'administrator'].includes(authorization.organizationRole);
  const assignedIds = [...new Set(authorization.assignments.map(({ scope }) => scope.tryoutId))];
  const loadEvents = async () => {
    let events: ReturnType<typeof eventNavigationOptions> = [];
    // Metadata only; no athlete data. An unavailable picker must not break the workspace.
    try {
      if (manager || assignedIds.length) {
        let query = client
          .from('tryouts')
          .select('id,name')
          .eq('organization_id', organization.id)
          .order('updated_at', { ascending: false });
        if (!manager) query = query.in('id', assignedIds);
        const { data, error } = await query;
        if (!error && data) events = eventNavigationOptions(authorization, organization.slug, data);
      }
    } catch {
      /* Existing navigation remains available. */
    }
    return events;
  };
  const [{ data: hasScoutingAccess }, workspaces, events] = await Promise.all([
    client.rpc('can_use_talent', { p_organization_id: organization.id }),
    loadWorkspaceNavigation(client, organization.id),
    loadEvents(),
  ]);
  return (
    <PrivateSessionBoundary userId={userId}>
      <AppShell
        events={events}
        eventStorageKey={`tryoutflow.selected-event.${userId}.${organization.id}`}
        navigation={buildAppNavigation({
          authorization,
          tryoutNames: Object.fromEntries(events.map(({ id, name }) => [id, name])),
          organizationSlug: organization.slug,
          hasScoutingAccess: !!hasScoutingAccess,
          isTeamWorkspace: workspaces.isTeam,
        })}
        organization={organization}
        roleLabel={describeAppRole(authorization)}
      >
        <p className="sr-only">{organization.name}</p>
        <WorkspaceSwitcher currentId={organization.id} navigation={workspaces} />
        {children}
      </AppShell>
    </PrivateSessionBoundary>
  );
}
