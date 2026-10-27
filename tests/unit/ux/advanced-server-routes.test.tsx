import '../../stubs/navigation-browser';
import { render, screen, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { FEATURE_KEYS } from '../../../src/modules/subscriptions/domain/feature-catalog';
import { ids, readOnlyFictionalClient, type FixtureState } from './fictional-route-client';

const state = vi.hoisted(
  () => ({ tables: {}, rpcs: {}, tableErrors: {}, calls: [], user: null }) as FixtureState,
);
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => readOnlyFictionalClient(state),
  hasSupabaseSessionCookie: () => false,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('FIXTURE_NOT_FOUND');
  },
  redirect: (href: string) => {
    throw new Error(`FIXTURE_REDIRECT:${href}`);
  },
  usePathname: () => '/app/fictional',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => {
      throw new Error('No cookie writes');
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

const prefix = '../../../src/app/(app)/app/[organizationSlug]/';
const cases = [
  ['athletes/new', 'Add an athlete'],
  ['athletes/duplicates', 'Duplicate review'],
  ['athletes/[athleteId]', 'Fictional Athlete'],
  ['performance/import', 'Import performance measurements'],
  ['performance', 'Performance lab'],
  ['scouting', 'Scouting workspace'],
  ['search', 'Search your organization'],
  ['participants', 'Families & access'],
  ['tryouts/[tryoutId]/stations', 'Stations & rotations'],
  ['tryouts/[tryoutId]/scenarios', 'Roster scenarios'],
  ['tryouts/[tryoutId]/operations', 'Event operations'],
  ['tryouts/[tryoutId]/coverage', 'Evaluation coverage'],
  ['organization/integrations', 'Integrations'],
  ['organization/settings', 'Organization settings'],
  ['organization/members', 'Organization members'],
  ['organization/teams', 'Team workspaces'],
  ['reports/scouting', 'Scouting & performance'],
  ['reports/program', 'Program progression'],
  ['reports/exports', 'Performance exports'],
  ['reports/athletes/[athleteId]', 'Fictional Athlete'],
  ['evaluate/calibration', 'Evaluator calibration'],
  ['organization/audit', 'Audit history'],
  ['tryouts/[tryoutId]/eligibility', 'Eligibility and exceptions'],
  ['tryouts/[tryoutId]/sessions', 'Sessions'],
  ['tryouts/[tryoutId]/live', 'Run Tryout'],
] as const;
const params = { organizationSlug: 'fictional', tryoutId: ids.tryout, athleteId: ids.athlete };
beforeEach(() => {
  state.user = { id: ids.user, email: 'fictional@example.test' };
  state.calls = [];
  state.tableErrors = {};
  state.tables = {
    organizations: [
      {
        id: ids.organization,
        name: 'Fictional Club',
        slug: 'fictional',
        timezone: 'UTC',
        terminology: {},
        sport_defaults: [],
        tag_defaults: [],
      },
    ],
    organization_members: [
      { organization_id: ids.organization, user_id: ids.user, role: 'owner', status: 'active' },
    ],
    tryouts: [
      {
        id: ids.tryout,
        organization_id: ids.organization,
        name: 'Fictional U14 Tryout',
        status: 'draft',
        sport: 'Basketball',
        timezone: 'UTC',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    athletes: [
      {
        id: ids.athlete,
        organization_id: ids.organization,
        given_name: 'Fictional',
        family_name: 'Athlete',
        birth_date: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
  };
  state.rpcs = {
    can_use_talent: true,
    get_workspace_navigation: {
      isTeam: false,
      parent: null,
      workspaces: [
        { id: ids.organization, name: 'Fictional Club', slug: 'fictional', isTeam: false },
      ],
    },
    list_team_workspaces: [],
    list_organization_invitations: [],
    program_attendance: [],
    list_performance_exports: [],
    calibration_workspace: [],
    load_live_dashboard: [
      {
        result: {
          outcome: 'ok',
          dashboard: {
            registrations: 0,
            checkedIn: 0,
            activeEvaluators: 0,
            completedEvaluations: 0,
            expectedEvaluations: 0,
            recordedSyncExceptions: 0,
            generatedAt: '2026-01-01T00:00:00Z',
          },
        },
      },
    ],
    get_organization_logo_metadata: [],
    scouting_people: [],
    event_coverage: [],
    read_athlete_portrait: null,
    list_organization_evaluators: [],
    get_effective_entitlements: {
      organizationId: ids.organization,
      tryoutId: null,
      plan: 'organization',
      source: 'manual',
      features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])),
      limits: {
        active_tryouts: null,
        athletes_per_tryout: null,
        evaluators_per_tryout: null,
        custom_templates: null,
      },
      evaluatedAt: '2026-01-01T00:00:00Z',
      expiresAt: null,
    },
  };
});
afterEach(cleanup);
describe('actual advanced server page presentation with read-only fictional backend', () => {
  it.each(cases)('renders %s through its unchanged loader/role checks', async (route, _heading) => {
    const pageModule = await import(/* @vite-ignore */ `${prefix}${route}/page.tsx`);
    const node = await pageModule.default({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({}),
    });
    render(node as ReactNode);
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('Unconfigured fictional RPC');
    expect(
      state.calls.some(
        (call) =>
          call.table === 'organization_members' &&
          call.operation === 'eq' &&
          call.args[0] === 'user_id' &&
          call.args[1] === ids.user,
      ),
    ).toBe(true);
  });
  it.each([
    'athletes/new',
    'athletes/duplicates',
    'participants',
    'tryouts/[tryoutId]/stations',
    'tryouts/[tryoutId]/scenarios',
    'tryouts/[tryoutId]/operations',
    'tryouts/[tryoutId]/eligibility',
  ])('keeps %s unavailable to a member even with fictional scouting access', async (route) => {
    state.tables.organization_members![0]!.role = 'member';
    const page = await import(/* @vite-ignore */ `${prefix}${route}/page.tsx`);
    await expect(
      page.default({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('FIXTURE_NOT_FOUND');
  });
  it('preserves approved-family versus shared-staff feedback and excludes private notes', async () => {
    state.tables.scouting_records = [
      {
        id: 'private',
        organization_id: ids.organization,
        athlete_id: ids.athlete,
        kind: 'report',
        visibility: 'private',
        status: 'approved',
        title: 'PRIVATE_SENTINEL',
        body: 'private',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'staff',
        organization_id: ids.organization,
        athlete_id: ids.athlete,
        kind: 'report',
        visibility: 'staff',
        status: 'approved',
        title: 'STAFF_SENTINEL',
        body: 'staff',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'family',
        organization_id: ids.organization,
        athlete_id: ids.athlete,
        kind: 'report',
        visibility: 'athlete',
        status: 'approved',
        title: 'APPROVED_SENTINEL',
        body: 'approved',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'draft',
        organization_id: ids.organization,
        athlete_id: ids.athlete,
        kind: 'report',
        visibility: 'athlete',
        status: 'draft',
        title: 'DRAFT_SENTINEL',
        body: 'draft',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    const page =
      await import('../../../src/app/(app)/app/[organizationSlug]/reports/athletes/[athleteId]/page');
    const view = render(
      await page.default({
        params: Promise.resolve(params),
        searchParams: Promise.resolve({ audience: 'athlete' }),
      }),
    );
    expect(screen.getByText('APPROVED_SENTINEL')).toBeVisible();
    expect(document.body.textContent).not.toContain('PRIVATE_SENTINEL');
    expect(document.body.textContent).not.toContain('STAFF_SENTINEL');
    expect(document.body.textContent).not.toContain('DRAFT_SENTINEL');
    view.unmount();
    render(
      await page.default({
        params: Promise.resolve(params),
        searchParams: Promise.resolve({ audience: 'staff' }),
      }),
    );
    expect(screen.getByText('STAFF_SENTINEL')).toBeVisible();
    expect(document.body.textContent).not.toContain('PRIVATE_SENTINEL');
  });
  it('retains the search query and truthful partial-failure recovery', async () => {
    state.tableErrors.athletes = 'Synthetic unavailable query';
    const page = await import('../../../src/app/(app)/app/[organizationSlug]/search/page');
    render(
      await page.default({
        params: Promise.resolve(params),
        searchParams: Promise.resolve({ q: 'Fictional' }),
      }),
    );
    expect(screen.getByLabelText('Athlete, tryout or evaluator')).toHaveValue('Fictional');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some results could not load. Refresh to retry.',
    );
  });
  it('renders selected-athlete comparison through the actual scoped gateway without private evaluator notes', async () => {
    const second = '91000000-0000-4000-8000-000000000020';
    state.rpcs.load_ranking_snapshot = [
      {
        result: {
          outcome: 'ok',
          snapshot: {
            generatedAt: '2026-01-01T00:00:00Z',
            filterOptions: { divisions: [], positions: [], sessions: [], groups: [] },
            registrations: [ids.athlete, second].map((athleteId, index) => ({
              registrationId:
                index === 0
                  ? '91000000-0000-4000-8000-000000000007'
                  : '91000000-0000-4000-8000-000000000021',
              athleteId,
              displayName: `Fictional Comparison ${index + 1}`,
              divisionId: ids.division,
              divisionName: 'Fictional U14',
              positionId: null,
              positionName: null,
              tryoutNumber: index + 12,
              expectedEvaluators: 1,
              evaluations: [],
              categoryNames: [],
              sessions: [],
              groups: [],
              flags: [],
            })),
          },
        },
      },
    ];
    const page =
      await import('../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/compare/page');
    render(
      await page.default({
        params: Promise.resolve(params),
        searchParams: Promise.resolve({ athletes: `${ids.athlete},${second}` }),
      }),
    );
    expect(screen.getByRole('link', { name: 'Back to rankings' })).toBeVisible();
    expect(screen.queryByText('Comparison unavailable')).toBeNull();
    expect(screen.getAllByText('Fictional Comparison 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fictional Comparison 2').length).toBeGreaterThan(0);
    expect(state.calls).toContainEqual(
      expect.objectContaining({
        rpc: 'load_ranking_snapshot',
        args: [
          expect.objectContaining({
            p_organization_id: ids.organization,
            p_tryout_id: ids.tryout,
            p_athlete_ids: [ids.athlete, second],
          }),
        ],
      }),
    );
  });
});
