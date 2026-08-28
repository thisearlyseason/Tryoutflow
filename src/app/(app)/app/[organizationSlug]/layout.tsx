import type { ReactNode } from 'react';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const { organization } = await requireCurrentOrganization(organizationSlug);
  return (
    <AppShell
      navigation={
        <nav
          aria-label="Organization navigation"
          className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <Link href={`/app/${organization.slug}/home`}>Home</Link>
          {' · '}
          <Link href={`/app/${organization.slug}/organization/members`}>Members</Link>
          {' · '}
          <Link href={`/app/${organization.slug}/organization/settings`}>Settings</Link>
        </nav>
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
