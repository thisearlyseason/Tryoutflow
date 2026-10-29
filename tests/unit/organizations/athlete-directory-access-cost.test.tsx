import { beforeEach, expect, it, vi } from 'vitest';
import Page from '@/app/(app)/app/[organizationSlug]/athletes/page';
const state = vi.hoisted(() => ({ rpc: vi.fn(), range: vi.fn(), role: 'owner' }));
vi.mock('@/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: async () => ({
    organization: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'fictional' },
    authorization: {
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: '11111111-1111-4111-8111-111111111111',
      organizationRole: state.role,
      membershipStatus: 'active',
      assignments: [],
    },
    client: {
      rpc: state.rpc,
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          range: state.range,
        };
        return query;
      },
    },
  }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not_found');
  },
  redirect: () => {
    throw new Error('redirect');
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.role = 'owner';
  state.range.mockResolvedValue({ data: [], count: 0, error: null });
});
const params = {
  params: Promise.resolve({ organizationSlug: 'fictional' }),
  searchParams: Promise.resolve({}),
};
it('does not wait for talent billing when current role already grants athlete access', async () => {
  state.rpc.mockRejectedValue(new Error('must not be requested'));
  expect(await Page(params)).toBeTruthy();
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.range).toHaveBeenCalledOnce();
});
it.each([false, null])(
  'still denies a restricted role without talent entitlement: %s',
  async (entitled) => {
    state.role = 'member';
    state.rpc.mockResolvedValue({ data: entitled, error: null });
    await expect(Page(params)).rejects.toThrow('not_found');
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('can_use_talent', {
      p_organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(state.range).not.toHaveBeenCalled();
  },
);
it('preserves the existing entitled-member access path', async () => {
  state.role = 'member';
  state.rpc.mockResolvedValue({ data: true, error: null });
  expect(await Page(params)).toBeTruthy();
  expect(state.range).toHaveBeenCalledOnce();
});
