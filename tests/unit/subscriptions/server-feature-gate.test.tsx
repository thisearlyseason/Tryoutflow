import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  summary: vi.fn(),
  capture: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/modules/subscriptions/application/billing-service', () => ({
  getEffectiveEntitlements: mocks.access,
}));
vi.mock('@/modules/subscriptions/ui/feature-gate', () => ({
  FeatureGate: ({ feature }: { feature: string }) => (
    <div data-testid="feature-gate">{feature}</div>
  ),
}));
vi.mock('@/modules/organizations/application/organization-route-context', () => ({
  requireOrganizationRouteContext: async () => ({
    userId: 'e53bbff7-ca1c-46d6-856b-0152543d8064',
    organization: { id: '80fd05f0-fe47-41e8-8352-26499c4f25b6' },
    client: { from: mocks.from },
  }),
}));
vi.mock('@/modules/organizations/application/team-workspaces', () => ({
  loadWorkspaceNavigation: async () => ({ isTeam: false }),
}));
vi.mock('@/modules/reports/infrastructure/supabase-report-gateway', () => ({
  SupabaseReportGateway: class {
    summary = mocks.summary;
  },
}));
vi.mock('@/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.capture,
}));
import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import OrganizationReportsPage from '@/app/(app)/app/[organizationSlug]/reports/page';
import type { FeatureKey } from '@/modules/subscriptions/domain/feature-catalog';
const org = '80fd05f0-fe47-41e8-8352-26499c4f25b6';
const event = 'd47ec535-32c8-4fd5-ac1d-ce084b36c958';
const free = {
  organizationId: org,
  tryoutId: null,
  plan: 'free',
  source: 'free',
  features: { basic_evaluations: true, create_tryout: true },
  limits: {
    active_tryouts: null,
    athletes_per_tryout: null,
    evaluators_per_tryout: null,
    custom_templates: null,
  },
  evaluatedAt: '2026-10-19T18:00:00Z',
  expiresAt: null,
};
const features: FeatureKey[] = [
  'organization_reporting',
  'advanced_scouting',
  'export_reports',
  'advanced_rankings',
  'unlimited_evaluators',
  'custom_templates',
  'organization_management',
  'custom_branding',
  'player_comparison',
  'radar_charts',
  'advanced_evaluations',
];
beforeEach(() => {
  vi.stubEnv('BILLING_ENVIRONMENT', '');
  mocks.access.mockReset().mockResolvedValue(free);
  mocks.summary.mockReset();
  mocks.capture.mockReset();
  mocks.from.mockReset().mockReturnValue({
    select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('authoritative server feature prompts', () => {
  it.each(features)(
    'gates ungranted %s without a payment provider environment',
    async (feature) => {
      const result = await billingUpgradePrompt(org, 'thisisatest', feature, event);
      expect(result).not.toBeNull();
      expect(
        (result as ReactElement<{ feature: FeatureKey; access: unknown; billingHref: string }>)
          .props,
      ).toMatchObject({
        feature,
        access: free,
        billingHref: '/app/thisisatest/organization/billing',
      });
      expect(mocks.access).toHaveBeenCalledWith(org, event);
    },
  );
  it.each(features)('preserves granted %s', async (feature) => {
    mocks.access.mockResolvedValue({ ...free, features: { [feature]: true } });
    expect(await billingUpgradePrompt(org, 'thisisatest', feature, event)).toBeNull();
  });
  it.each(['live', 'sandbox', ''])(
    'keeps sparse feature denial consistent for provider setting %s',
    async (setting) => {
      vi.stubEnv('BILLING_ENVIRONMENT', setting);
      expect(
        await billingUpgradePrompt(org, 'thisisatest', 'organization_reporting'),
      ).not.toBeNull();
    },
  );
  it('keeps free basic scoring available', async () => {
    expect(await billingUpgradePrompt(org, 'thisisatest', 'basic_evaluations')).toBeNull();
  });
  it('does not grant access on entitlement lookup failure', async () => {
    mocks.access.mockRejectedValue(new Error('billing_access_unavailable'));
    await expect(
      billingUpgradePrompt(org, 'thisisatest', 'organization_reporting'),
    ).rejects.toThrow('billing_access_unavailable');
  });
});
describe('actual organization Reports route', () => {
  it('shows free-plan upgrade state and never invokes gated summary RPC', async () => {
    render(
      await OrganizationReportsPage({
        params: Promise.resolve({ organizationSlug: 'thisisatest' }),
      }),
    );
    expect(screen.getByTestId('feature-gate')).toHaveTextContent('organization_reporting');
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('retains a link to the existing tryout in the free-plan view', async () => {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [{ id: event, name: 'QA Save Reload 2026-10-19' }],
            error: null,
          }),
        }),
      }),
    });
    render(
      await OrganizationReportsPage({
        params: Promise.resolve({ organizationSlug: 'thisisatest' }),
      }),
    );
    expect(screen.getByRole('link', { name: /QA Save Reload/ })).toHaveAttribute(
      'href',
      `/app/thisisatest/tryouts/${event}/reports`,
    );
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it('renders entitled empty summary normally', async () => {
    mocks.access.mockResolvedValue({ ...free, features: { organization_reporting: true } });
    mocks.summary.mockResolvedValue({
      kind: 'manager',
      summary: {
        athleteCount: 0,
        completedEvaluationCount: 0,
        incompleteEvaluationCount: 0,
        finalizedRosterCount: 0,
        latestFinalizedRosterId: null,
      },
    });
    render(
      await OrganizationReportsPage({
        params: Promise.resolve({ organizationSlug: 'thisisatest' }),
      }),
    );
    expect(screen.getByText('No report data yet')).toBeVisible();
    expect(mocks.summary).toHaveBeenCalledWith(org);
  });
  it('retains truthful error fallback for an entitled RPC failure', async () => {
    mocks.access.mockResolvedValue({ ...free, features: { organization_reporting: true } });
    mocks.summary.mockRejectedValue(new Error('synthetic RPC failure'));
    render(
      await OrganizationReportsPage({
        params: Promise.resolve({ organizationSlug: 'thisisatest' }),
      }),
    );
    expect(screen.getByText('Reports unavailable')).toBeVisible();
    expect(screen.queryByText('No report data yet')).toBeNull();
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'report.load', organizationId: org }),
    );
  });
});
