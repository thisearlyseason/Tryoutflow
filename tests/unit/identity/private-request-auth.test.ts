// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membership: vi.fn(),
  create: vi.fn(),
  cookie: vi.fn(),
}));
const client = {
  auth: { getUser: mocks.getUser },
  from: vi.fn(() => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.membership }) }) }),
  })),
};
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mocks.create(...args),
}));
vi.mock('@/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: () => mocks.cookie(),
}));
vi.mock('@/lib/env', () => ({
  getClientEnvironment: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.example',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-fixture',
  }),
}));
import {
  billingRequestContext,
  ownerBillingContext,
} from '@/modules/subscriptions/application/billing-request';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReturnValue(client);
  mocks.cookie.mockResolvedValue(client);
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
});
test.each([undefined, `Bearer ${'a'.repeat(24)}`])(
  'private cookie/Bearer requests reject missing or expired verified users (%s)',
  async (authorization) => {
    const request = new Request('https://app.example/api/billing/organizations', {
      headers: authorization ? { authorization } : {},
    });
    await expect(billingRequestContext(request)).rejects.toThrow('unauthorized');
    expect(client.from).not.toHaveBeenCalled();
  },
);
test('malformed native authorization is rejected before initializing a client', async () => {
  await expect(
    billingRequestContext(
      new Request('https://app.example/api/billing/organizations', {
        headers: { authorization: 'Basic fixture' },
      }),
    ),
  ).rejects.toThrow('unauthorized');
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.cookie).not.toHaveBeenCalled();
});
test('a cross-origin web mutation is rejected before accessing session or private data', async () => {
  await expect(
    billingRequestContext(
      new Request('https://app.example/api/private', {
        method: 'POST',
        headers: { origin: 'https://other.example' },
      }),
    ),
  ).rejects.toThrow('forbidden');
  expect(mocks.cookie).not.toHaveBeenCalled();
});
test.each([{ role: 'member', status: 'active' }, { role: 'owner', status: 'inactive' }, null])(
  'a verified login does not grant owner privileges without active membership %j',
  async (membership) => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'verified-fixture' } }, error: null });
    mocks.membership.mockResolvedValue({ data: membership, error: null });
    await expect(
      ownerBillingContext(new Request('https://app.example/api/private'), 'organization-fixture'),
    ).rejects.toThrow('forbidden');
  },
);
