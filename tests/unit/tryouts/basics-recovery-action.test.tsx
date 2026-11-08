import { render } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  persist: vi.fn(),
  saveConfiguration: vi.fn(),
  action: null as null | ((state: unknown, data: FormData) => Promise<unknown>),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw Error('REDIRECT:' + path);
  },
  notFound: () => {
    throw Error('NOT_FOUND');
  },
}));
vi.mock('@/modules/subscriptions/ui/server-feature-gate', () => ({
  billingUpgradePrompt: async () => null,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: mocks.current,
}));
vi.mock('@/modules/tryouts/application/single-tryout-lifecycle', () => ({
  loadSingleTryoutLifecycle: async () => ({ sealed: false, single: false, completed: false }),
}));
vi.mock('@/modules/tryouts/application/publish-tryout', () => ({
  validateTryoutForPublish: async () => ({ ok: true, value: { blockers: [] } }),
  publishTryout: vi.fn(),
}));
vi.mock('@/modules/tryouts/application/save-wizard-configuration', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveWizardConfiguration: mocks.saveConfiguration,
}));
vi.mock('@/modules/tryouts/application/persist-wizard-step', () => ({
  persistWizardStep: mocks.persist,
}));
vi.mock('@/infrastructure/analytics/supabase-analytics-provider', () => ({
  trackSupabaseWorkflowSafely: vi.fn(),
}));
vi.mock('@/modules/tryouts/ui/tryout-wizard', () => ({
  TryoutWizard: (props: { action: typeof mocks.action }) => {
    mocks.action = props.action;
    return <p>Wizard</p>;
  },
}));
import Page from '@/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/setup/[step]/page';
const event = '22222222-2222-4222-8222-222222222222';
const basics = {
  id: event,
  name: 'Event',
  sport: 'Hockey',
  timezone: 'UTC',
  registration_starts_at: null,
  registration_ends_at: null,
  status: 'draft',
  version: 3,
};
function setup(freshVersion: number) {
  let reads = 0;
  const client = {
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({
          data:
            table === 'tryouts'
              ? { ...basics, version: ++reads === 1 ? 3 : freshVersion }
              : { completed_steps: [] },
          error: null,
        }),
      };
      return b;
    },
    rpc: async () => ({ data: { divisions: [], sessions: [], positions: [] }, error: null }),
  };
  mocks.current.mockResolvedValue({
    organization: { id: 'org', slug: 'club' },
    userId: 'user',
    authorization: {
      userId: 'user',
      organizationId: 'org',
      organizationRole: 'owner',
      membershipStatus: 'active',
      assignments: [],
    },
    client,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.action = null;
  mocks.persist.mockResolvedValue({ kind: 'saved', nextStep: 'divisions' });
});
async function save(step = 'basics', intent?: string) {
  render(
    await Page({
      params: Promise.resolve({ organizationSlug: 'club', tryoutId: event, step }),
      searchParams: Promise.resolve({}),
    }),
  );
  const data = new FormData();
  for (const [key, value] of Object.entries({
    name: 'Local edit',
    sport: 'Hockey',
    timezone: 'UTC',
    registrationStartsAt: '2026-11-10T10:00',
    registrationEndsAt: '2026-11-11T10:00',
  }))
    data.set(key, value);
  if (intent) data.set('intent', intent);
  return mocks.action!({ status: 'idle' }, data);
}
it('rejects a server version changed since the restored Basics view before any persistence', async () => {
  setup(4);
  expect(await save()).toMatchObject({
    status: 'form_error',
    message: expect.stringMatching(/changed/),
  });
  expect(mocks.persist).not.toHaveBeenCalled();
});
it('returns confirmed saved navigation only after an unchanged Basics version persists', async () => {
  setup(3);
  expect(await save()).toEqual({
    status: 'saved',
    href: `/app/club/tryouts/${event}/setup/divisions`,
  });
  expect(mocks.persist).toHaveBeenCalledOnce();
});

it('passes the bound version through the validated payload into the atomic database command', async () => {
  setup(3);
  mocks.saveConfiguration.mockResolvedValue({ ok: true });
  mocks.persist.mockImplementation(async (input, dependencies) => {
    await dependencies.saveConfiguration({
      ...input,
      payload: {
        name: 'Local edit',
        sport: 'Hockey',
        timezone: 'UTC',
        registrationStartsAt: '2026-11-10T10:00',
        registrationEndsAt: '2026-11-11T10:00',
      },
    });
    return { kind: 'advance', nextStep: 'divisions' };
  });
  await save();
  expect(mocks.saveConfiguration).toHaveBeenCalledWith(
    expect.objectContaining({ payload: expect.objectContaining({ expectedVersion: 3 }) }),
    expect.anything(),
  );
});

it('explains an atomic database version conflict without confirming a save', async () => {
  setup(3);
  mocks.persist.mockResolvedValue({
    kind: 'error',
    code: 'conflict',
    values: {
      name: 'Local edit',
      sport: 'Hockey',
      timezone: 'UTC',
      registrationStartsAt: '2026-11-10T10:00',
      registrationEndsAt: '2026-11-11T10:00',
    },
  });
  expect(await save()).toMatchObject({
    status: 'form_error',
    message: expect.stringMatching(/changed/),
    values: { name: 'Local edit' },
  });
});

it.each(['divisions', 'sessions', 'rubrics', 'registration'])(
  'guards the rendered %s version and passes it to the locked database command',
  async (step) => {
    setup(4);
    expect(await save(step)).toMatchObject({
      status: 'form_error',
      message: expect.stringMatching(/changed/),
    });
    expect(mocks.persist).not.toHaveBeenCalled();
    setup(3);
    mocks.saveConfiguration.mockResolvedValue({ ok: true });
    mocks.persist.mockImplementation(async (input, dependencies) => {
      await dependencies.saveConfiguration(input);
      return { kind: 'advance', nextStep: step === 'divisions' ? 'sessions' : 'registration' };
    });
    expect(await save(step)).toMatchObject({
      status: 'saved',
      href: expect.stringContaining('/setup/'),
    });
    expect(mocks.saveConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ expectedVersion: 3 }) }),
      expect.anything(),
    );
  },
);
it('returns confirmed add-another navigation for division cleanup', async () => {
  setup(3);
  expect(await save('divisions', 'add-another')).toEqual({
    status: 'saved',
    href: `/app/club/tryouts/${event}/setup/divisions?saved=1&new=1`,
  });
});
