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
  const { organization, authorization, client } =
    await requireOrganizationRouteContext(organizationSlug);
  const { data: hasScoutingAccess } = await client.rpc('can_use_talent', {
    p_organization_id: organization.id,
  });
  const workspaces = await loadWorkspaceNavigation(client, organization.id);
  return (
    <AppShell
      navigation={buildAppNavigation({
        authorization,
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
  );
}
