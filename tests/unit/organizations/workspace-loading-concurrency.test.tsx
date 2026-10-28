import { beforeEach, expect, it, vi } from 'vitest';
import OrganizationLayout from '@/app/(app)/app/[organizationSlug]/layout';
import OrganizationHome from '@/app/(app)/app/[organizationSlug]/home/page';

const boundary = vi.hoisted(() => ({ authorize: vi.fn(), workspaces: vi.fn(), progress: vi.fn() }));
vi.mock('@/modules/organizations/application/organization-route-context', () => ({
  requireOrganizationRouteContext: boundary.authorize,
}));
vi.mock('@/modules/organizations/application/team-workspaces', () => ({
  loadWorkspaceNavigation: boundary.workspaces,
}));
vi.mock('@/modules/organizations/infrastructure/supabase-onboarding-progress-gateway', () => ({
  SupabaseOnboardingProgressGateway: class {
    load = boundary.progress;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function query<T>(promise: Promise<T>) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: promise.then.bind(promise),
  };
  for (const key of ['select', 'eq', 'order', 'limit'] as const) chain[key].mockReturnValue(chain);
  return chain;
}
const organization = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'fictional',
  name: 'Fictional Club',
};
const authorization = {
  organizationRole: 'owner',
  assignments: [],
  membershipStatus: 'active',
  organizationId: organization.id,
  userId: '11111111-1111-4111-8111-111111111111',
};
beforeEach(() => {
  vi.resetAllMocks();
});

it('waits for authorization, then starts all independent shell reads before any completes', async () => {
  const auth = deferred<unknown>(),
    scouting = deferred<unknown>(),
    workspaces = deferred<unknown>(),
    events = deferred<unknown>();
  const eventQuery = query(events.promise);
  const client = { rpc: vi.fn(() => scouting.promise), from: vi.fn(() => eventQuery) };
  boundary.authorize.mockReturnValue(auth.promise);
  boundary.workspaces.mockReturnValue(workspaces.promise);
  const render = OrganizationLayout({
    params: Promise.resolve({ organizationSlug: 'fictional' }),
    children: null,
  });
  await vi.waitFor(() => expect(boundary.authorize).toHaveBeenCalled());
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.from).not.toHaveBeenCalled();
  auth.resolve({ organization, authorization, client, userId: authorization.userId });
  await vi.waitFor(() => {
    expect(client.rpc).toHaveBeenCalledWith('can_use_talent', {
      p_organization_id: organization.id,
    });
    expect(boundary.workspaces).toHaveBeenCalledWith(client, organization.id);
    expect(client.from).toHaveBeenCalledWith('tryouts');
  });
  scouting.resolve({ data: false });
  workspaces.resolve({ isTeam: false, parent: null, workspaces: [] });
  events.resolve({ data: [], error: null });
  expect(await render).toBeTruthy();
  expect(eventQuery.eq).toHaveBeenCalledWith('organization_id', organization.id);
});

it('starts progress and bounded activity reads together instead of waiting for progress first', async () => {
  const progress = deferred<null>(),
    tryouts = deferred<unknown>(),
    athletes = deferred<unknown>();
  const tryoutQuery = query(tryouts.promise),
    athleteQuery = query(athletes.promise);
  const client = {
    from: vi.fn((table: string) => (table === 'tryouts' ? tryoutQuery : athleteQuery)),
  };
  boundary.authorize.mockResolvedValue({
    organization,
    authorization,
    client,
    userId: authorization.userId,
  });
  boundary.progress.mockReturnValue(progress.promise);
  const render = OrganizationHome({ params: Promise.resolve({ organizationSlug: 'fictional' }) });
  await vi.waitFor(() => {
    expect(boundary.progress).toHaveBeenCalledWith(organization.id);
    expect(client.from).toHaveBeenCalledWith('tryouts');
    expect(client.from).toHaveBeenCalledWith('athletes');
  });
  expect(tryoutQuery.limit).toHaveBeenCalledWith(4);
  expect(athleteQuery.limit).toHaveBeenCalledWith(4);
  progress.resolve(null);
  tryouts.resolve({ data: [], error: null });
  athletes.resolve({ data: [], error: null });
  expect(await render).toBeTruthy();
});
