import { beforeEach, expect, it, vi } from 'vitest';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  authorize: vi.fn(),
  organization: vi.fn(),
}));
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: m.getUser },
    from: m.from,
    rpc: m.rpc,
  }),
}));
vi.mock('@/modules/organizations/infrastructure/membership-repository', () => ({
  SupabaseMembershipRepository: class {
    findOrganizationContext = m.authorize;
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not_found');
  },
}));
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  user = '11111111-1111-4111-8111-111111111111';
const authorization = {
  userId: user,
  organizationId: org,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};
const metadata = {
  data: [{ logo_exists: true, sha256: 'a'.repeat(64), updated_at: '2026-10-29T12:00:00Z' }],
  error: null,
};
beforeEach(async () => {
  vi.resetAllMocks();
  m.getUser.mockResolvedValue({ data: { user: { id: user } }, error: null });
  m.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: m.organization }) }) });
  m.organization.mockResolvedValue({
    data: {
      id: org,
      name: 'Fictional QA',
      slug: 'fictional-qa',
      timezone: 'UTC',
      terminology: {},
      sport_defaults: [],
      tag_defaults: [],
    },
    error: null,
  });
  m.authorize.mockResolvedValue({ organization: (await m.organization()).data, authorization });
  m.rpc.mockResolvedValue(metadata);
});
it('waits for fresh joined authority and skips unused branding on normal pages', async () => {
  let authorize!: (value: unknown) => void;
  let completed = false;
  m.authorize.mockReturnValue(
    new Promise((resolve) => {
      authorize = resolve;
    }),
  );
  const pending = requireCurrentOrganization('fictional-qa').then((value) => {
    completed = true;
    return value;
  });
  await vi.waitFor(() => expect(m.authorize).toHaveBeenCalledOnce());
  expect(m.rpc).not.toHaveBeenCalled();
  expect(completed).toBe(false);
  authorize({ organization: (await m.organization()).data, authorization });
  expect((await pending).organization.logoUrl).toBeUndefined();
});
it('loads branding only when explicitly needed by the logo settings page', async () => {
  const result = await requireCurrentOrganization('fictional-qa', { includeBranding: true });
  expect(result.organization.logoUrl).toContain('/api/organizations/fictional-qa/logo?v=');
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('get_organization_logo_metadata', {
    p_organization_id: org,
  });
});
it.each([null, { ...authorization, organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])(
  'never exposes already-loaded branding when authority is denied or belongs to another tenant',
  async (value) => {
    m.authorize.mockResolvedValue(
      value === null ? null : { organization: (await m.organization()).data, authorization: value },
    );
    await expect(requireCurrentOrganization('fictional-qa')).rejects.toThrow('not_found');
  },
);
it('still renders an authorized workspace if optional branding is unavailable', async () => {
  m.rpc.mockRejectedValue(new Error('metadata unavailable'));
  const result = await requireCurrentOrganization('fictional-qa', { includeBranding: true });
  expect(result.authorization).toEqual(authorization);
  expect(result.organization.logoUrl).toBeUndefined();
});
it('does not load organization or branding data before the signed-in user is established', async () => {
  m.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(requireCurrentOrganization('fictional-qa')).rejects.toThrow('not_found');
  expect(m.from).not.toHaveBeenCalled();
  expect(m.authorize).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it('checks live authority again after revocation on the next call', async () => {
  await requireCurrentOrganization('fictional-qa');
  m.authorize.mockResolvedValue(null);
  await expect(requireCurrentOrganization('fictional-qa')).rejects.toThrow('not_found');
  expect(m.getUser).toHaveBeenCalledTimes(2);
  expect(m.authorize).toHaveBeenCalledTimes(2);
});
it('cannot replace an authorization failure with successful branding', async () => {
  m.authorize.mockRejectedValue(new Error('authority unavailable'));
  await expect(requireCurrentOrganization('fictional-qa')).rejects.toThrow('authority unavailable');
});
