import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/organizations/[organizationId]/billing/checkout/route';

const mocks = vi.hoisted(() => ({ load: vi.fn(), authenticate: vi.fn() }));
vi.mock('@/app/api/organizations/[organizationId]/billing/billing-route-dependencies', () => ({
  createBillingRouteDependencies: mocks.load,
  authenticateBillingRouteOrganization: mocks.authenticate,
}));

const origin = 'https://www.tryout.agency';
const organizationId = '11111111-1111-4111-8111-111111111111';
const validBody = {
  plan: 'team',
  clientAttemptId: '22222222-2222-4222-8222-222222222222',
  checkoutProtocol: 'managed_v1',
  billingCountry: 'CA',
};
const invoke = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request(`${origin}/api/organizations/${organizationId}/billing/checkout`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', ...headers },
      body,
    }),
    { params: Promise.resolve({ organizationId }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
  mocks.authenticate.mockResolvedValue({ organizationSlug: 'test-workspace', actor: {} });
  mocks.load.mockRejectedValue(new Error('private credential and configuration diagnostics'));
});

describe('checkout rejection while provider initialization is unavailable', () => {
  it.each([
    ['Apple native context', JSON.stringify(validBody), { cookie: 'tryoutflow-native=apple' }, 403],
    [
      'Google native context',
      JSON.stringify(validBody),
      { cookie: 'tryoutflow-native=google' },
      403,
    ],
    ['foreign origin', JSON.stringify(validBody), { origin: 'https://evil.invalid' }, 403],
    ['missing origin', JSON.stringify(validBody), { origin: '' }, 403],
    ['unsupported content type', JSON.stringify(validBody), { 'content-type': 'text/plain' }, 415],
    ['malformed JSON', '{', {}, 400],
    ['invalid checkout body', '{}', {}, 400],
    ['oversized body', 'a'.repeat(1025), {}, 413],
  ] as const)(
    'rejects %s without initializing a provider',
    async (_name, body, headers, status) => {
      expect((await invoke(body, headers)).status).toBe(status);
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.authenticate).not.toHaveBeenCalled();
    },
  );

  it('keeps a valid request fail closed when provider initialization fails', async () => {
    const response = await invoke(JSON.stringify(validBody));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'billing_unavailable' });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('still rejects unauthenticated valid requests before checkout or provider activity', async () => {
    mocks.authenticate.mockResolvedValue(null);
    const response = await invoke(JSON.stringify(validBody));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(mocks.authenticate).toHaveBeenCalledWith(organizationId);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('does not disclose private authentication diagnostics', async () => {
    mocks.authenticate.mockRejectedValue(new Error('private auth details'));
    const response = await invoke(JSON.stringify(validBody));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'billing_unavailable' });
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
