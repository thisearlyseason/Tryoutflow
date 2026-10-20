import { NativeBillingEntry } from '../../../../../../../src/modules/subscriptions/ui/native-billing-entry';
import { AppShell } from '../../../../../../../src/components/layout/app-shell';
import { OrganizationCommandCenter } from '../../../../../../../src/modules/organizations/components/organization-command-center';
import { createOrganizationDashboardProjection } from '../../../../../../../src/modules/organizations/application/onboarding-progress';
const groups = [
  {
    id: 'overview',
    label: 'Overview',
    items: [{ href: '/app/local/home', label: 'Home', icon: 'home' as const }],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { href: '/app/local/tryouts', label: 'Tryouts', icon: 'tryouts' as const },
      { href: '/app/local/athletes', label: 'Athletes', icon: 'athletes' as const },
      { href: '/app/local/setup/basics', label: 'Tryout setup', icon: 'tryouts' as const },
      {
        href: '/app/local/evaluate/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        label: 'Evaluations',
        icon: 'athletes' as const,
      },
      { href: '/app/local/rankings', label: 'Rankings', icon: 'athletes' as const },
      { href: '/app/local/charts', label: 'Charts', icon: 'athletes' as const },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { href: '/app/local/organization/billing', label: 'Billing', icon: 'organization' as const },
    ],
  },
];
export default async function Page({ params }: { params: Promise<{ screen: string[] }> }) {
  const { screen } = await params;
  const projection = createOrganizationDashboardProjection({
    organizationExists: true,
    settingsConfigured: false,
    registrationConfigured: false,
    activeStaffCount: 0,
    publishedRubricCount: 0,
    sessionCount: 0,
    completedEvaluationCount: 0,
    finalizedRosterCount: 0,
  });
  return (
    <AppShell
      organization={{ name: 'LOCAL LAYOUT FIXTURE', slug: 'local' }}
      roleLabel="Owner"
      navigation={groups}
    >
      {screen[0] === 'home' ? (
        <OrganizationCommandCenter
          organizationSlug="local"
          showManagementActions
          projection={projection}
        />
      ) : (
        <section className="card">
          <h1>{screen.join(' / ')}</h1>
          <p>Local synthetic layout fixture. No live account or payment data.</p>
          {screen.join('/') === 'organization/billing' ? (
            <p>Native purchases are outside this local fixture. No provider connection.</p>
          ) : null}
          <div style={{ minHeight: 900 }}>Scrollable page content</div>
          <p>End of page</p>
        </section>
      )}
    </AppShell>
  );
}
