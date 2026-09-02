import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = '11111111-1111-4111-8111-111111111111';
const tryoutId = '22222222-2222-4222-8222-222222222222';
const otherTenantTryoutId = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  getLiveDashboard: vi.fn(),
  reportSummary: vi.fn(),
  requireCapability: vi.fn(),
  requireCurrentOrganization: vi.fn(),
  requireOrganizationRouteContext: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.captureOperationalError,
}));
vi.mock('../../../src/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: mocks.requireCurrentOrganization,
}));
vi.mock('../../../src/modules/organizations/application/organization-route-context', () => ({
  requireOrganizationRouteContext: mocks.requireOrganizationRouteContext,
}));
vi.mock('../../../src/modules/organizations/application/require-capability', () => ({
  requireCapability: mocks.requireCapability,
}));
vi.mock('../../../src/modules/tryouts/application/get-live-dashboard', () => ({
  getLiveDashboard: mocks.getLiveDashboard,
  SupabaseLiveDashboardGateway: class SupabaseLiveDashboardGateway {},
}));
vi.mock('../../../src/modules/reports/infrastructure/supabase-report-gateway', () => ({
  SupabaseReportGateway: class SupabaseReportGateway {
    summary() {
      return mocks.reportSummary();
    }
  },
}));

import CheckinPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/check-in/page';
import LivePage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/live/page';
import MessagesPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/messages/page';
import TryoutRegistrationPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/registration/page';
import TryoutReportsPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/reports/page';
import RostersPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/page';
import TryoutSessionsPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/sessions/page';

type QueryResult = { data: unknown; error: unknown; count?: number | null };

function clientWith(
  results: Record<string, QueryResult>,
  rpcResult: QueryResult = { data: [], error: null },
) {
  return {
    rpc: vi.fn(async () => rpcResult),
    from: vi.fn((table: string) => {
      const result = results[table] ?? { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(result),
        then<TResult1 = QueryResult, TResult2 = never>(
          onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(result).then(onfulfilled, onrejected);
        },
      };
      return builder;
    }),
  };
}

function route(client: ReturnType<typeof clientWith>) {
  return {
    authorization: {
      userId,
      organizationId,
      organizationRole: 'owner',
      membershipStatus: 'active',
      assignments: [],
    },
    client,
    organization: { id: organizationId, name: 'Badlands', slug: 'badlands' },
    userId,
  };
}

function expectOverviewNavigation() {
  expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
    'href',
    `/app/badlands/tryouts/${tryoutId}/overview`,
  );
}

describe('tryout stage dependency navigation', () => {
  beforeEach(() => {
    mocks.captureOperationalError.mockReset();
    mocks.getLiveDashboard.mockReset();
    mocks.reportSummary.mockReset();
    mocks.requireCapability.mockReset();
    mocks.requireCapability.mockImplementation((_: unknown, capability: string) => ({
      ok: capability !== 'audit:read',
    }));
    mocks.requireCurrentOrganization.mockReset();
    mocks.requireOrganizationRouteContext.mockReset();
  });

  it('keeps overview navigation when sessions fail to load', async () => {
    const current = route(
      clientWith({
        tryouts: { data: { id: tryoutId, name: 'Fall Evaluations' }, error: null },
        tryout_sessions: { data: null, error: new Error('sessions unavailable') },
      }),
    );
    mocks.requireCurrentOrganization.mockResolvedValue(current);

    render(
      await TryoutSessionsPage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Sessions temporarily unavailable' })).toBeVisible();
    expectOverviewNavigation();
  });

  it.each([
    ['tryout', { tryouts: { data: null, error: new Error('tryout unavailable') } }],
    [
      'sessions',
      {
        tryouts: { data: { id: tryoutId, name: 'Fall Evaluations' }, error: null },
        tryout_sessions: { data: null, error: new Error('sessions unavailable') },
      },
    ],
  ] as const)(
    'keeps overview navigation when check-in %s loading fails',
    async (_label, results) => {
      mocks.requireCurrentOrganization.mockResolvedValue(route(clientWith(results)));

      render(
        await CheckinPage({
          params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
          searchParams: Promise.resolve({}),
        }),
      );

      expect(
        screen.getByRole('heading', { name: 'Check-in temporarily unavailable' }),
      ).toBeVisible();
      expectOverviewNavigation();
    },
  );

  it('keeps overview navigation when the live dashboard dependency fails', async () => {
    mocks.requireOrganizationRouteContext.mockResolvedValue(route(clientWith({})));
    mocks.getLiveDashboard.mockResolvedValue({
      ok: false,
      error: { code: 'unexpected' },
    });

    render(
      await LivePage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Live dashboard unavailable' })).toBeVisible();
    expectOverviewNavigation();
  });

  it('keeps overview navigation when initial roster configuration fails', async () => {
    mocks.requireOrganizationRouteContext.mockResolvedValue(
      route(
        clientWith({
          tryouts: {
            data: { id: tryoutId, name: 'Fall Evaluations', status: 'published' },
            error: null,
          },
          tryout_divisions: { data: null, error: new Error('divisions unavailable') },
          roster_versions: { data: [], error: null },
        }),
      ),
    );

    render(
      await RostersPage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Roster workspace unavailable' })).toBeVisible();
    expectOverviewNavigation();
  });

  it('keeps overview navigation when the initial roster tryout dependency fails', async () => {
    mocks.requireOrganizationRouteContext.mockResolvedValue(
      route(
        clientWith({
          tryouts: { data: null, error: new Error('tryout unavailable') },
          tryout_divisions: { data: [], error: null },
          roster_versions: { data: [], error: null },
        }),
      ),
    );

    render(
      await RostersPage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Roster workspace unavailable' })).toBeVisible();
    expectOverviewNavigation();
  });

  it('keeps overview navigation when the participant configuration RPC fails', async () => {
    mocks.requireCurrentOrganization.mockResolvedValue(
      route(clientWith({}, { data: null, error: new Error('configuration unavailable') })),
    );

    render(
      await TryoutRegistrationPage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole('heading', { name: 'Registration workspace unavailable' }),
    ).toBeVisible();
    expectOverviewNavigation();
  });

  it('keeps overview navigation for a malformed nonempty participant configuration', async () => {
    mocks.requireCurrentOrganization.mockResolvedValue(
      route(
        clientWith(
          {},
          {
            data: [{ tryout_name: 'Fall Evaluations', tryout_status: 'published' }],
            error: null,
          },
        ),
      ),
    );

    render(
      await TryoutRegistrationPage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole('heading', { name: 'Registration workspace unavailable' }),
    ).toBeVisible();
    expectOverviewNavigation();
  });

  it('keeps a successful cross-tenant zero-row configuration link-free and non-oracular', async () => {
    mocks.requireCurrentOrganization.mockResolvedValue(
      route(clientWith({}, { data: [], error: null })),
    );

    render(
      await TryoutRegistrationPage({
        params: Promise.resolve({
          organizationSlug: 'badlands',
          tryoutId: otherTenantTryoutId,
        }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Tryout registration not found' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Back to overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /next:/iu })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(otherTenantTryoutId);
  });

  it('keeps overview navigation when the initial messages dependency fails', async () => {
    mocks.requireOrganizationRouteContext.mockResolvedValue(
      route(
        clientWith({
          tryouts: { data: null, error: new Error('tryout unavailable') },
          roster_versions: { data: [], error: null },
        }),
      ),
    );

    render(
      await MessagesPage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Messages temporarily unavailable' })).toBeVisible();
    expectOverviewNavigation();
  });

  it('does not offer audit navigation when a report reader lacks audit capability', async () => {
    mocks.requireOrganizationRouteContext.mockResolvedValue(route(clientWith({})));
    mocks.reportSummary.mockResolvedValue(null);

    render(
      await TryoutReportsPage({
        params: Promise.resolve({ organizationSlug: 'badlands', tryoutId }),
      }),
    );

    expectOverviewNavigation();
    expect(screen.queryByRole('link', { name: /review audit history/iu })).not.toBeInTheDocument();
  });
});
