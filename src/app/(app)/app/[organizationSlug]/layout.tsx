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
  const { organization, authorization } = await requireOrganizationRouteContext(organizationSlug);
  return (
    <AppShell
      navigation={buildAppNavigation({ authorization, organizationSlug: organization.slug })}
      organization={organization}
      roleLabel={describeAppRole(authorization)}
    >
      <h1 className="sr-only">{organization.name}</h1>
      {children}
    </AppShell>
  );
}
