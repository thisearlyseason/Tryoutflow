import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  owner: vi.fn(),
  context: vi.fn(),
  reconcile: vi.fn(),
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  single: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  price: vi.fn(),
}));
vi.mock('@/modules/subscriptions/application/billing-request', () => ({
  ownerBillingContext: m.owner,
}));
vi.mock('@/modules/subscriptions/application/billing-service', () => ({
  providerContext: m.context,
  reconcileOrganizationSubscription: m.reconcile,
}));
vi.mock('@/infrastructure/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ rpc: m.adminRpc }),
}));
vi.mock('@/modules/subscriptions/providers/stripe', () => ({
  stripeBillingClient: () => ({
    checkout: { sessions: { create: m.create, retrieve: m.retrieve } },
    prices: { retrieve: m.price },
  }),
}));
import { POST, GET } from '@/app/api/organizations/[organizationId]/billing/actions/route';
import { BILLING_PRODUCT_KEYS } from '@/modules/subscriptions/domain/billing-products';
import { stripeCheckoutIdentity } from '@/modules/subscriptions/providers/stripe-checkout-identity';
const org = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const event = '33333333-3333-4333-8333-333333333333';
const attempt = '44444444-4444-4444-8444-444444444444';
const origin = 'https://synthetic-billing.example.test';
const client = {
  rpc: m.rpc,
  from: () => ({
    select: () => ({
      eq: () => ({
        single: m.single,
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    }),
  }),
};
const purchase = (product: string) => ({
  action: 'purchase',
  provider: 'stripe',
  product,
  attemptId: attempt,
  checkoutProtocol: 'managed_v1',
  billingCountry: 'CA',
  tryoutId: product === 'single_tryout_pro' ? event : null,
});
const invoke = (body: object) =>
  POST(
    new Request(`${origin}/api/organizations/${org}/billing/actions`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ organizationId: org }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
  vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
  vi.stubEnv('BILLING_CHECKOUT_ENABLED', 'true');
  vi.stubEnv('BILLING_NATIVE_PURCHASES_ENABLED', 'false');
  vi.stubEnv('STRIPE_MANAGED_SELLER_COUNTRY', 'CA');
  for (const key of BILLING_PRODUCT_KEYS)
    vi.stubEnv(`STRIPE_PRICE_${key.toUpperCase()}`, `price_synthetic_${key}`);
  m.owner.mockResolvedValue({ client, user: { id: user }, isNative: false });
  m.context.mockResolvedValue({ contracts: [], intents: [], environment: 'sandbox' });
  m.rpc.mockImplementation(async (name) =>
    name === 'get_billing_dashboard'
      ? { data: { purchasesEnabled: true }, error: null }
      : name === 'reserve_billing_purchase'
        ? { data: { created_at: '2026-10-08T00:00:00.000Z' }, error: null }
        : { data: null, error: null },
  );
  m.single.mockResolvedValue({ data: { slug: 'synthetic-workspace' }, error: null });
  m.adminRpc.mockResolvedValue({ data: null, error: null });
  m.price.mockResolvedValue({
    active: true,
    livemode: false,
    product: { active: true, livemode: false, tax_code: 'txcd_10103000' },
  });
  m.create.mockResolvedValue({
    id: 'cs_test_synthetic',
    url: 'https://checkout.stripe.com/c/pay/cs_test_synthetic',
    managed_payments: { enabled: true },
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('exact five-offer web request boundary, all dependencies synthetic', () => {
  it.each(BILLING_PRODUCT_KEYS)(
    'resumes pre-return-identity %s without replaying changed payload or creating another Session',
    async (product) => {
      const old = stripeCheckoutIdentity(attempt, 'managed_v1', 'CA');
      const single = product === 'single_tryout_pro';
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const pending = {
        id: old.intentId,
        organization_id: org,
        purchaser_id: user,
        provider: 'stripe',
        product_key: product,
        tryout_id: single ? event : null,
        contract_id: null,
        expires_at: new Date(expires * 1000).toISOString(),
        provider_session_id: 'cs_test_previous',
      };
      m.context.mockResolvedValue({ contracts: [], intents: [pending], environment: 'sandbox' });
      // Model the existing organization lock: replaying the old ID would succeed,
      // while a distinct reservation conflicts and must recover the saved Session.
      m.rpc.mockImplementation(async (name, params) =>
        name === 'reserve_billing_purchase'
          ? params.p_id === old.intentId
            ? { data: { created_at: new Date().toISOString() }, error: null }
            : { data: null, error: { message: 'purchase_in_progress' } }
          : { data: { purchasesEnabled: true }, error: null },
      );
      m.retrieve.mockResolvedValue({
        id: 'cs_test_previous',
        status: 'open',
        payment_status: 'unpaid',
        livemode: false,
        mode: single ? 'payment' : 'subscription',
        expires_at: expires,
        client_reference_id: old.intentId,
        managed_payments: { enabled: true },
        metadata: {
          billing_version: '2',
          billing_intent_id: old.intentId,
          organization_id: org,
          purchaser_id: user,
          product_key: product,
          tax_protocol: 'managed_v1',
          managed_billing_country: 'CA',
          ...(single ? { tryout_id: event } : {}),
        },
        line_items: {
          has_more: false,
          data: [{ price: { id: `price_synthetic_${product}` }, quantity: 1 }],
        },
        url: 'https://checkout.stripe.com/c/pay/cs_test_previous',
        success_url: `${origin}/app/synthetic-workspace/organization/billing?checkout=complete`,
        cancel_url: `${origin}/app/synthetic-workspace/organization/billing?checkout=cancelled`,
      });
      const response = await invoke(purchase(product));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url: 'https://checkout.stripe.com/c/pay/cs_test_previous',
      });
      expect(m.retrieve).toHaveBeenCalledWith('cs_test_previous', { expand: ['line_items'] });
      expect(m.create).not.toHaveBeenCalled();
      expect(m.price).not.toHaveBeenCalled();
      expect(m.adminRpc).not.toHaveBeenCalled();
      expect(
        m.rpc.mock.calls.find(([name]) => name === 'reserve_billing_purchase')![1].p_id,
      ).not.toBe(old.intentId);
    },
  );
  it('waits for an older unsaved Session intent to expire without creating a duplicate', async () => {
    const old = stripeCheckoutIdentity(attempt, 'managed_v1', 'CA');
    m.context.mockResolvedValue({
      contracts: [],
      intents: [
        {
          id: old.intentId,
          organization_id: org,
          purchaser_id: user,
          provider: 'stripe',
          product_key: 'pro_monthly',
          tryout_id: null,
          contract_id: null,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          provider_session_id: null,
        },
      ],
      environment: 'sandbox',
    });
    m.rpc.mockImplementation(async (name) =>
      name === 'reserve_billing_purchase'
        ? { data: null, error: { message: 'purchase_in_progress' } }
        : { data: { purchasesEnabled: true }, error: null },
    );
    const response = await invoke(purchase('pro_monthly'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('checkout_tax_transition_pending');
    expect(m.create).not.toHaveBeenCalled();
    expect(m.retrieve).not.toHaveBeenCalled();
    expect(m.adminRpc).not.toHaveBeenCalled();
  });
  it('replays the new version with identical Stripe payload/key after interrupted persistence', async () => {
    m.adminRpc.mockResolvedValueOnce({ error: new Error('synthetic save interrupted') });
    expect((await invoke(purchase('pro_monthly'))).status).toBe(503);
    expect((await invoke(purchase('pro_monthly'))).status).toBe(200);
    expect(m.create).toHaveBeenCalledTimes(2);
    expect(m.create.mock.calls[1]).toEqual(m.create.mock.calls[0]);
    const legacy = stripeCheckoutIdentity(attempt, 'managed_v1', 'CA');
    expect(m.create.mock.calls[0]![1].idempotencyKey).not.toBe(legacy.idempotencyKey);
    expect(m.create.mock.calls[0]![0].client_reference_id).not.toBe(legacy.intentId);
  });
  it.each(BILLING_PRODUCT_KEYS)(
    'creates %s with exact owner/product/scope and no entitlement write',
    async (product) => {
      const response = await invoke(purchase(product));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url: 'https://checkout.stripe.com/c/pay/cs_test_synthetic',
      });
      const [params, options] = m.create.mock.calls[0]!;
      const single = product === 'single_tryout_pro';
      expect(params).toMatchObject({
        mode: single ? 'payment' : 'subscription',
        line_items: [{ price: `price_synthetic_${product}`, quantity: 1 }],
        managed_payments: { enabled: true },
        metadata: {
          billing_version: '2',
          organization_id: org,
          purchaser_id: user,
          product_key: product,
          tax_protocol: 'managed_v1',
          managed_seller_country: 'CA',
          managed_billing_country: 'CA',
        },
        success_url: expect.stringMatching(
          new RegExp(
            `^${origin}/app/synthetic-workspace/organization/billing\\?checkout=complete&intent=[a-f0-9-]{36}$`,
          ),
        ),
        cancel_url: expect.stringMatching(
          new RegExp(
            `^${origin}/app/synthetic-workspace/organization/billing\\?checkout=cancelled&intent=[a-f0-9-]{36}$`,
          ),
        ),
      });
      expect(params.metadata.tryout_id).toBe(single ? event : undefined);
      expect(params[single ? 'payment_intent_data' : 'subscription_data'].metadata).toEqual(
        params.metadata,
      );
      expect(params.client_reference_id).toBe(params.metadata.billing_intent_id);
      expect(new URL(params.success_url).searchParams.get('intent')).toBe(
        params.client_reference_id,
      );
      expect(new URL(params.cancel_url).searchParams.get('intent')).toBe(
        params.client_reference_id,
      );
      expect(options.idempotencyKey).toContain(params.client_reference_id);
      expect(m.rpc.mock.calls.map(([name]) => name)).toEqual([
        'get_billing_dashboard',
        'reserve_billing_purchase',
      ]);
      expect(m.adminRpc).toHaveBeenCalledWith('complete_billing_checkout', {
        p_intent_id: params.client_reference_id,
        p_session_id: 'cs_test_synthetic',
      });
      expect(m.reconcile).not.toHaveBeenCalled();
    },
  );
  it.each(BILLING_PRODUCT_KEYS)(
    'blocks disabled web checkout before reservation/provider for %s',
    async (product) => {
      vi.stubEnv('BILLING_CHECKOUT_ENABLED', 'false');
      const response = await invoke(purchase(product));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('checkout_disabled');
      expect(m.rpc.mock.calls.map(([name]) => name)).toEqual(['get_billing_dashboard']);
      expect(m.create).not.toHaveBeenCalled();
      expect(m.price).not.toHaveBeenCalled();
      expect(m.adminRpc).not.toHaveBeenCalled();
    },
  );
  it.each(BILLING_PRODUCT_KEYS)(
    'rejects opting out of Managed before reservation/provider for %s',
    async (product) => {
      const response = await invoke({ ...purchase(product), checkoutProtocol: 'standard_v1' });
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('managed_checkout_required');
      expect(m.rpc.mock.calls.map(([name]) => name)).toEqual(['get_billing_dashboard']);
      expect(m.create).not.toHaveBeenCalled();
    },
  );
  it.each(['DE', 'ca', '', null])(
    'rejects unsupported country %s before reservation/provider',
    async (country) => {
      const response = await invoke({ ...purchase('pro_monthly'), billingCountry: country });
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('managed_billing_country_required');
      expect(m.rpc.mock.calls.map(([name]) => name)).toEqual(['get_billing_dashboard']);
      expect(m.create).not.toHaveBeenCalled();
    },
  );
  it('rejects absent Canadian seller readiness before reservation/provider', async () => {
    vi.stubEnv('STRIPE_MANAGED_SELLER_COUNTRY', 'US');
    const response = await invoke(purchase('pro_monthly'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('managed_coverage_unavailable');
    expect(m.rpc.mock.calls.map(([name]) => name)).toEqual(['get_billing_dashboard']);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('rejects unverified Managed provider response before saving session', async () => {
    m.create.mockResolvedValue({
      id: 'cs_test_synthetic',
      url: 'https://checkout.stripe.com/c/pay/cs_test_synthetic',
      managed_payments: { enabled: false },
    });
    expect((await invoke(purchase('pro_monthly'))).status).toBe(503);
    expect(m.adminRpc).not.toHaveBeenCalled();
  });
  it('fails closed when checkout session ledger completion fails', async () => {
    m.adminRpc.mockResolvedValue({ error: new Error('synthetic persistence failure') });
    expect((await invoke(purchase('pro_monthly'))).status).toBe(503);
    expect(m.reconcile).not.toHaveBeenCalled();
  });
  it('does not reserve or invoke providers for an unauthorized owner', async () => {
    m.owner.mockRejectedValue(new Error('forbidden'));
    expect((await invoke(purchase('pro_monthly'))).status).toBe(503);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.context).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it('native purchase remains disabled before ledger/provider work', async () => {
    expect((await invoke({ ...purchase('pro_monthly'), provider: 'apple' })).status).toBe(409);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.context).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
  it('reload and either checkout query read the ledger only, never provider/reconcile', async () => {
    for (const query of ['', '?checkout=complete', '?checkout=cancelled']) {
      expect(
        (
          await GET(new Request(`${origin}/api/organizations/${org}/billing/actions${query}`), {
            params: Promise.resolve({ organizationId: org }),
          })
        ).status,
      ).toBe(200);
    }
    expect(m.rpc.mock.calls.map(([name]) => name)).toEqual(Array(3).fill('get_billing_dashboard'));
    expect(m.context).not.toHaveBeenCalled();
    expect(m.reconcile).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.adminRpc).not.toHaveBeenCalled();
  });
  it.each(BILLING_PRODUCT_KEYS)(
    'exact return status for %s is derived from scoped ledger only',
    async (product) => {
      const id = '66666666-6666-5666-a666-666666666666';
      const contract = '77777777-7777-4777-8777-777777777777';
      const scope = product === 'single_tryout_pro' ? event : null;
      m.context.mockResolvedValue({
        contracts: [
          {
            id: contract,
            organization_id: org,
            purchaser_id: user,
            provider: 'stripe',
            product_key: product,
            tryout_id: scope,
            status: 'active',
            current_period_start: new Date(Date.now() - 60000).toISOString(),
            current_period_end: scope ? null : new Date(Date.now() + 3600000).toISOString(),
            grace_period_end: null,
          },
        ],
        intents: [
          {
            id,
            organization_id: org,
            purchaser_id: user,
            provider: 'stripe',
            product_key: product,
            tryout_id: scope,
            contract_id: contract,
            expires_at: new Date(Date.now() - 1000).toISOString(),
          },
        ],
        environment: 'sandbox',
      });
      const response = await GET(
        new Request(`${origin}/api/organizations/${org}/billing/actions?intent=${id}`),
        { params: Promise.resolve({ organizationId: org }) },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).checkout).toEqual({ intentId: id, status: 'confirmed' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(m.context).toHaveBeenCalledWith(org, user);
      expect(m.reconcile).not.toHaveBeenCalled();
      expect(m.create).not.toHaveBeenCalled();
      expect(m.price).not.toHaveBeenCalled();
      expect(m.adminRpc).not.toHaveBeenCalled();
    },
  );
  it('malformed/duplicate return identity cannot read private purchase context', async () => {
    for (const query of ['intent=not-a-uuid', `intent=${attempt}&intent=${attempt}`]) {
      expect(
        (
          await GET(new Request(`${origin}/api/organizations/${org}/billing/actions?${query}`), {
            params: Promise.resolve({ organizationId: org }),
          })
        ).status,
      ).toBe(403);
    }
    expect(m.context).not.toHaveBeenCalled();
    expect(m.reconcile).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });
});
