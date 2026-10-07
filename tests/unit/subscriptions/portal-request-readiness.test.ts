import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/organizations/[organizationId]/billing/portal/route';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), load: vi.fn() }));
vi.mock('@/app/api/organizations/[organizationId]/billing/billing-route-dependencies', () => ({
  authenticateBillingRouteOrganization: mocks.authenticate,
  createBillingPortalRouteDependencies: mocks.load,
}));
const origin = 'https://www.tryout.agency';
const organizationId = '11111111-1111-4111-8111-111111111111';
const body = JSON.stringify({ clientAttemptId: '22222222-2222-4222-8222-222222222222' });
const invoke = (value: string = body, headers: Record<string, string> = {}) =>
  POST(
    new Request(`${origin}/api/organizations/${organizationId}/billing/portal`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body: value,
    }),
    { params: Promise.resolve({ organizationId }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
  mocks.authenticate.mockResolvedValue({ organizationSlug: 'test-org', actor: {} });
  mocks.load.mockRejectedValue(new Error('private provider details'));
});

it.each([
  ['invalid JSON', '{', {}, 400],
  ['invalid body', '{}', {}, 400],
  ['foreign origin', body, { origin: 'https://evil.invalid' }, 403],
  ['native context', body, { cookie: 'tryoutflow-native=apple' }, 403],
] as const)(
  'rejects %s before auth or provider initialization',
  async (_name, value, headers, status) => {
    expect((await invoke(value, headers)).status).toBe(status);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  },
);
it('rejects an unauthenticated valid request before initializing management', async () => {
  mocks.authenticate.mockResolvedValue(null);
  const response = await invoke();
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'forbidden' });
  expect(mocks.load).not.toHaveBeenCalled();
});
it('does not expose private provider initialization errors', async () => {
  const response = await invoke();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'billing_unavailable' });
  expect(mocks.load).toHaveBeenCalledOnce();
});
