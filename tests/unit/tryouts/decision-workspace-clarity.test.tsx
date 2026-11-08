import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
const tryoutId = '22222222-2222-4222-8222-222222222222';
const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  talent: vi.fn(),
  path: '/app/fixture/tryouts/22222222-2222-4222-8222-222222222222/scenarios',
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.path,
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => {
    throw Error('NOT_FOUND');
  },
}));
vi.mock('@/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: mocks.current,
}));
vi.mock('@/modules/organizations/application/organization-route-context', () => ({
  requireOrganizationRouteContext: mocks.current,
}));
vi.mock('@/modules/tryouts/application/single-tryout-lifecycle', () => ({
  loadSingleTryoutLifecycle: async () => null,
}));
vi.mock('@/modules/talent/application/workspace', () => ({ loadTalent: mocks.talent }));
vi.mock('@/modules/talent/ui/record-form', () => ({
  EditRecord: ({ title }: { title: string }) => <button>{title}</button>,
}));
vi.mock('@/modules/rosters/ui/roster-builder', () => ({
  RosterDraftSetup: () => <h2>Create roster draft</h2>,
  RosterBuilder: () => <h2>Existing roster</h2>,
}));
import Layout from '@/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/layout';
import Scenarios from '@/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/scenarios/page';
import Rosters from '@/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/rosters/page';
const params = Promise.resolve({ organizationSlug: 'fixture', tryoutId });
function current(role = 'owner', assigned: string[] = []) {
  return {
    organization: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'fixture' },
    authorization: {
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      organizationRole: role,
      membershipStatus: 'active',
      assignments: assigned.map((role) => ({ role, scope: { kind: 'tryout', tryoutId } })),
    },
  };
}
function client(results: Record<string, unknown>) {
  return {
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        order: () => b,
        maybeSingle: async () => ({ data: results[table], error: null }),
        then: (resolve: (x: unknown) => unknown) =>
          Promise.resolve({ data: results[table] ?? [], error: null }).then(resolve),
      };
      return b;
    },
  };
}
beforeEach(() => vi.clearAllMocks());
describe('draft comparisons and official roster distinction', () => {
  it('retains authorized URLs with distinct manager labels', async () => {
    mocks.current.mockResolvedValue(current());
    render(await Layout({ params, children: <h1>Decision work</h1> }));
    const nav = screen.getByRole('navigation', { name: 'Tryout workspace' });
    expect(within(nav).getByRole('link', { name: 'Compare draft options' })).toHaveAttribute(
      'href',
      `/app/fixture/tryouts/${tryoutId}/scenarios`,
    );
    expect(within(nav).getByRole('link', { name: 'Official roster' })).toHaveAttribute(
      'href',
      `/app/fixture/tryouts/${tryoutId}/rosters`,
    );
  });
  it.each(['director', 'reviewer'])(
    'does not give %s access to scenario management',
    async (role) => {
      mocks.current.mockResolvedValue(current('member', [role]));
      render(await Layout({ params, children: <h1>Decision work</h1> }));
      expect(screen.getByRole('link', { name: 'Official roster' })).toBeVisible();
      expect(screen.queryByRole('link', { name: 'Compare draft options' })).toBeNull();
    },
  );
  it.each(['draft', 'approved'])(
    'explains scenario %s without implying finalization or private-only offers',
    async (status) => {
      mocks.talent.mockResolvedValue({
        current: {
          ...current(),
          client: client({
            roster_scenarios: [
              {
                id: 'scenario',
                name: 'Option A',
                status,
                target_size: 20,
                rationale: 'Balanced selection',
                version: 1,
              },
            ],
            roster_scenario_members: [],
          }),
        },
        tryouts: [{ id: tryoutId, name: 'Synthetic tryout' }],
        athletes: [],
      });
      render(await Scenarios({ params }));
      expect(
        screen.getByRole('heading', { name: 'Compare draft options', level: 1 }),
      ).toBeVisible();
      expect(
        screen.getByText(/Linked families can see offers from approved scenarios/),
      ).toBeVisible();
      expect(
        screen.getByText(/does not finalize the official roster or send roster decision messages/),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Open official roster workspace' })).toHaveAttribute(
        'href',
        `/app/fixture/tryouts/${tryoutId}/rosters`,
      );
      expect(screen.getByText(new RegExp(`Scenario status: ${status}`))).toBeVisible();
    },
  );
  it('identifies the official workspace while retaining draft and finalization safeguards', async () => {
    mocks.current.mockResolvedValue({
      ...current(),
      client: client({
        tryouts: { id: tryoutId, name: 'Synthetic tryout', status: 'published' },
        tryout_divisions: [{ id: '33333333-3333-4333-8333-333333333333', name: 'U15' }],
        roster_versions: [],
        tryout_positions: [],
      }),
    });
    render(await Rosters({ params, searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Synthetic tryout official rosters' }),
    ).toBeVisible();
    expect(screen.getByText(/remains a draft until you finalize it/)).toBeVisible();
    expect(
      screen.getByText(/Finalizing preserves history and does not communicate or export anything/),
    ).toBeVisible();
  });
});
