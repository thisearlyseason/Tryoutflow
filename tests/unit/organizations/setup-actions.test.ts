import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  createOrganization: vi.fn(),
  createTryout: vi.fn(),
  saveStep: vi.fn(),
  getUser: vi.fn(),
  current: vi.fn(),
  track: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock('@/modules/organizations/application/create-organization', () => ({
  createOrganization: mocks.createOrganization,
}));
vi.mock('@/modules/tryouts/application/create-tryout', () => ({
  createTryout: mocks.createTryout,
}));
vi.mock('@/modules/tryouts/application/save-tryout-setup-step', () => ({
  saveTryoutSetupStep: mocks.saveStep,
}));
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: mocks.current,
}));
vi.mock('@/infrastructure/analytics/supabase-analytics-provider', () => ({
  trackSupabaseWorkflowSafely: mocks.track,
}));
import { startOrganizationAction } from '@/modules/organizations/application/start-organization-action';
import { createTryoutDraftAction } from '@/modules/tryouts/application/create-tryout-draft-action';
const org = '10000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000002';
const event = '10000000-0000-4000-8000-000000000003';
const idle = { status: 'idle' } as const;
const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: user } } });
  mocks.createOrganization.mockResolvedValue({
    ok: true,
    value: { organization: { slug: 'club' } },
  });
  mocks.current.mockResolvedValue({
    userId: user,
    organization: { id: org, slug: 'club' },
    authorization: { organizationId: org },
    client: {},
  });
  mocks.createTryout.mockResolvedValue({ ok: true, value: { id: event } });
  mocks.saveStep.mockResolvedValue({ ok: true });
});
describe('setup actions', () => {
  it('takes successful organization setup to Home even when a plan entry was selected', async () => {
    await expect(
      startOrganizationAction(
        idle,
        form({ name: 'Club', slug: 'club', timezone: 'America/Edmonton', plan: 'pro' }),
      ),
    ).rejects.toThrow('REDIRECT:/app/club/home');
  });
  it('returns a useful conflict without redirecting or losing the form context', async () => {
    mocks.createOrganization.mockResolvedValue({ ok: false, error: { code: 'slug_conflict' } });
    expect(
      await startOrganizationAction(
        idle,
        form({ name: 'Club', slug: 'club', timezone: 'America/Edmonton' }),
      ),
    ).toMatchObject({ status: 'error', fieldErrors: { slug: expect.any(String) } });
  });
  it('never creates an organization after the session expires', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    await expect(startOrganizationAction(idle, form({ name: 'Club' }))).rejects.toThrow(
      'REDIRECT:/sign-in',
    );
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });
  it('records Basics before sending a created draft to Divisions', async () => {
    await expect(createTryoutDraftAction('club', idle, form({ name: 'Tryout' }))).resolves.toEqual({
      status: 'created',
      href: `/app/club/tryouts/${event}/setup/divisions`,
    });
    expect(mocks.saveStep).toHaveBeenCalledWith(
      { organizationId: org, tryoutId: event, step: 'basics' },
      { authorization: expect.any(Object) },
    );
    expect(mocks.track).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'workflow.started', workflow: 'tryout_setup' }),
    );
  });
  it('keeps an already-created draft recoverable if progress recording fails', async () => {
    mocks.saveStep.mockResolvedValue({ ok: false, error: { code: 'unexpected' } });
    await expect(createTryoutDraftAction('club', idle, form({ name: 'Tryout' }))).resolves.toEqual({
      status: 'created',
      href: `/app/club/tryouts/${event}/setup/basics?created=1&progress=retry`,
    });
    expect(mocks.createTryout).toHaveBeenCalledTimes(1);
  });
  it('retains domain validation for forged mixed cycle values', async () => {
    mocks.createTryout.mockResolvedValue({ ok: false, error: { code: 'invalid_input' } });
    expect(
      await createTryoutDraftAction(
        'club',
        idle,
        form({ seasonId: 'existing', newSeasonName: 'New' }),
      ),
    ).toMatchObject({ status: 'error' });
    expect(mocks.createTryout).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: 'existing', newSeasonName: 'New' }),
      expect.anything(),
    );
    expect(mocks.saveStep).not.toHaveBeenCalled();
  });
});
