import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { OrganizationNavigation } from '@/modules/organizations/components/organization-navigation';

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
      navigation={
        <OrganizationNavigation
          authorization={authorization}
          organizationSlug={organization.slug}
        />
      }
    >
      <header className="mb-6">
        <p className="eyebrow">{organization.slug}</p>
        <h1>{organization.name}</h1>
      </header>
      {children}
    </AppShell>
  );
}
