import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/organizations/[organizationId]/billing/actions/route';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), context: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/modules/subscriptions/application/billing-request', () => ({
  ownerBillingContext: mocks.owner,
}));
vi.mock('@/modules/subscriptions/application/billing-service', () => ({
  providerContext: mocks.context,
  reconcileOrganizationSubscription: vi.fn(),
}));
vi.mock('@/modules/subscriptions/providers/stripe', () => ({
  stripeBillingClient: () => {
    throw Error('Unexpected Stripe access');
  },
}));
const org = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const reservation = {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: org,
  purchaser_id: owner,
  product_key: 'pro_monthly',
  provider: 'google',
  environment: 'sandbox',
  tryout_id: null,
  contract_id: null,
  expires_at: new Date(Date.now() + 60000).toISOString(),
};
const invoke = (provider = 'google') =>
  POST(
    new Request(`https://www.tryout.agency/api/organizations/${org}/billing/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'purchase',
        product: 'pro_monthly',
        provider,
        attemptId: '44444444-4444-4444-8444-444444444444',
      }),
    }),
    { params: Promise.resolve({ organizationId: org }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.tryout.agency');
  vi.stubEnv('BILLING_NATIVE_PURCHASES_ENABLED', 'true');
  vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
  vi.stubEnv('REVENUECAT_GOOGLE_PRO_MONTHLY', 'test-product:monthly');
  mocks.owner.mockResolvedValue({
    client: { rpc: mocks.rpc, from: mocks.from },
    user: { id: owner },
    isNative: true,
  });
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({ single: async () => ({ data: { slug: 'fixture' }, error: null }) }),
    }),
  });
  mocks.context.mockResolvedValue({
    enabled: true,
    environment: 'sandbox',
    intents: [{ ...reservation }],
    contracts: [],
  });
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === 'get_billing_dashboard') return { data: { purchasesEnabled: true }, error: null };
    if (name === 'get_owned_subscription_account') return { data: [], error: null };
    if (name === 'reserve_billing_purchase')
      return args.p_id === reservation.id
        ? { data: { ...reservation }, error: null }
        : { data: null, error: { message: 'purchase_in_progress' } };
    throw Error('Unexpected RPC');
  });
});
afterEach(() => vi.unstubAllEnvs());
it('recovers a new-device attempt through the authenticated original reservation RPC', async () => {
  const response = await invoke();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    intentId: reservation.id,
    productId: 'test-product:monthly',
  });
  expect(mocks.rpc).toHaveBeenCalledWith('reserve_billing_purchase', {
    p_id: reservation.id,
    p_organization_id: org,
    p_tryout_id: null,
    p_product_key: 'pro_monthly',
    p_provider: 'google',
  });
});
it('checks all organization contracts, including subscriptions held by another owner', async () => {
  mocks.context.mockResolvedValue({
    enabled: true,
    environment: 'sandbox',
    intents: [reservation],
    contracts: [
      {
        organization_id: org,
        purchaser_id: 'other',
        environment: 'sandbox',
        tryout_id: null,
        status: 'active',
        current_period_end: null,
      },
    ],
  });
  expect((await invoke()).status).toBe(409);
  expect(mocks.context).toHaveBeenLastCalledWith(org);
  expect(mocks.rpc.mock.calls.filter(([name]) => name === 'reserve_billing_purchase')).toHaveLength(
    1,
  );
});
it('preserves the paid legacy subscription guard', async () => {
  const original = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation((name, args) =>
    name === 'get_owned_subscription_account'
      ? { data: [{ provider_subscription_id: 'paid', state: 'active' }], error: null }
      : original(name, args),
  );
  expect((await invoke()).status).toBe(409);
});
it('does not resume another purchaser reservation', async () => {
  mocks.context.mockResolvedValue({
    enabled: true,
    environment: 'sandbox',
    intents: [{ ...reservation, purchaser_id: 'other' }],
    contracts: [],
  });
  expect((await invoke()).status).toBe(409);
});
it('keeps native checkout disabled when its release flag is off', async () => {
  vi.stubEnv('BILLING_NATIVE_PURCHASES_ENABLED', 'false');
  expect((await invoke()).status).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('does not expose native reservation resumption to browser purchases', async () => {
  mocks.owner.mockResolvedValue({
    client: { rpc: mocks.rpc, from: mocks.from },
    user: { id: owner },
    isNative: false,
  });
  expect((await invoke()).status).toBe(400);
});
it('does not resume a reservation after owner authorization fails', async () => {
  mocks.owner.mockRejectedValue(new Error('forbidden'));
  expect((await invoke()).status).not.toBe(200);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
