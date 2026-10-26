import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { loadVerifiedNativePurchases } from '@/modules/subscriptions/providers/revenuecat-reconciliation';
import { getRevenueCatCustomer } from '@/modules/subscriptions/providers/revenuecat';
import {
  loadStripeCheckoutSnapshot,
  loadStripeSnapshot,
  stripeChargeSnapshots,
} from '@/modules/subscriptions/providers/stripe';
const mocks = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  invoices: { list: vi.fn(), retrieve: vi.fn() },
  charges: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  disputes: { list: vi.fn() },
  invoicePayments: { list: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn() } },
}));
vi.mock('stripe', () => ({
  default: class {
    subscriptions = mocks.subscriptions;
    invoices = mocks.invoices;
    charges = mocks.charges;
    paymentIntents = mocks.paymentIntents;
    disputes = mocks.disputes;
    invoicePayments = mocks.invoicePayments;
    checkout = mocks.checkout;
  },
}));
const user = '11111111-1111-4111-8111-111111111111';
const start = Date.parse('2026-10-01T00:00:00Z'),
  end = Date.parse('2026-11-01T00:00:00Z');
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('STRIPE_PRICE_PRO_MONTHLY', 'price_pro');
  vi.stubEnv('STRIPE_PRICE_ORGANIZATION_MONTHLY', 'price_org');
  vi.stubEnv('STRIPE_PRICE_SINGLE_TRYOUT_PRO', 'price_once');
  vi.stubEnv('REVENUECAT_PROJECT_ID', 'projTest');
  vi.stubEnv('REVENUECAT_SECRET_KEY', 'fixture');
  vi.stubEnv('REVENUECAT_V1_API_KEY', 'v1_fixture');
  vi.stubEnv('REVENUECAT_APPLE_PRO_MONTHLY', 'pro');
  vi.stubEnv('REVENUECAT_APPLE_ORGANIZATION_MONTHLY', 'org');
  vi.stubEnv('REVENUECAT_APPLE_SINGLE_TRYOUT_PRO', 'once');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function native(
  overrides: Record<string, unknown> = {},
  options: { owner?: string; nextPage?: boolean; purchase?: boolean } = {},
) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/v1/'))
      return Response.json({
        subscriber: {
          original_app_user_id: options.owner ?? user,
          subscriptions: {
            pro: {
              store: 'app_store',
              is_sandbox: true,
              expires_date: new Date(end).toISOString(),
              original_purchase_date: new Date(start).toISOString(),
              purchase_date: new Date(start).toISOString(),
              ownership_type: 'PURCHASED',
            },
          },
          non_subscriptions: {},
        },
      });
    if (url.includes('/products/'))
      return Response.json({ store_identifier: url.endsWith('prodOnce') ? 'once' : 'pro' });
    if (url.includes('/purchases?'))
      return Response.json({
        items: options.purchase
          ? [
              {
                id: 'purcStable',
                customer_id: user,
                original_customer_id: user,
                product_id: 'prodOnce',
                environment: 'sandbox',
                store: 'app_store',
                ownership: 'purchased',
                purchased_at: start,
                status: 'owned',
                quantity: 1,
              },
            ]
          : [],
        next_page: null,
      });
    if (url.includes('starting_after')) return Response.json({ items: [], next_page: null });
    return Response.json({
      items: [
        {
          id: 'subStable',
          customer_id: user,
          original_customer_id: user,
          product_id: 'prodPro',
          environment: 'sandbox',
          store: 'app_store',
          ownership: 'purchased',
          starts_at: start,
          current_period_starts_at: start,
          current_period_ends_at: end,
          ends_at: null,
          status: 'active',
          gives_access: true,
          auto_renewal_status: 'will_renew',
          ...overrides,
        },
      ],
      next_page: options.nextPage ? 'https://attacker.invalid/redirect' : null,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
describe('authoritative native recovery', () => {
  it('uses distinct V1 and V2 credentials during reconciliation', async () => {
    const fetcher = native();
    await loadVerifiedNativePurchases(user);
    for (const call of fetcher.mock.calls) {
      const [url, options] = call as unknown as [string, RequestInit];
      expect(new Headers(options.headers).get('authorization')).toBe(
        url.includes('/v1/') ? 'Bearer v1_fixture' : 'Bearer fixture',
      );
    }
  });
  it('fails closed when the V1 credential is absent instead of using a V2 key', async () => {
    const fetcher = native();
    vi.stubEnv('REVENUECAT_V1_API_KEY', '');
    await expect(getRevenueCatCustomer(user)).rejects.toThrow('native_billing_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('recovers stable identity and original purchase timing without webhook data', async () => {
    native();
    const [s] = await loadVerifiedNativePurchases(user);
    expect(s).toMatchObject({
      provider_contract_id: 'subStable',
      purchaser_id: user,
      product_key: 'pro_monthly',
      status: 'active',
      purchase_started_at: new Date(start).toISOString(),
    });
  });
  it('preserves current access while exposing the provider scheduled product', async () => {
    native({
      auto_renewal_status: 'will_not_renew',
      pending_changes: { product: { store_identifier: 'org' }, current_period_starts_at: end },
    });
    expect((await loadVerifiedNativePurchases(user))[0]).toMatchObject({
      status: 'active',
      cancel_at_period_end: true,
      pending_product_key: 'organization_monthly',
      downgrade_effective_at: new Date(end).toISOString(),
    });
  });
  it('honors provider revocation even when older customer info appears active', async () => {
    native({ gives_access: false, status: 'expired' });
    expect((await loadVerifiedNativePurchases(user))[0]?.status).toBe('expired');
  });
  it('rejects cross-account ownership', async () => {
    native({ original_customer_id: 'another-user' });
    await expect(loadVerifiedNativePurchases(user)).rejects.toThrow('purchase_account_conflict');
  });
  it('ignores receipts from the other environment', async () => {
    native({ environment: 'production' });
    expect(await loadVerifiedNativePurchases(user)).toEqual([]);
  });
  it('rebuilds pagination against RevenueCat instead of following response URLs', async () => {
    const f = native({}, { nextPage: true });
    await loadVerifiedNativePurchases(user);
    expect(
      f.mock.calls.every(([url]) => String(url).startsWith('https://api.revenuecat.com/')),
    ).toBe(true);
    expect(f.mock.calls.some(([url]) => String(url).includes('starting_after=subStable'))).toBe(
      true,
    );
  });
  it('loads independently identified one-time purchases', async () => {
    native({}, { purchase: true });
    expect(await loadVerifiedNativePurchases(user)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider_contract_id: 'purcStable',
          product_key: 'single_tryout_pro',
          current_period_end: null,
        }),
      ]),
    );
  });
});
const subscription = (status = 'active') => ({
  id: 'sub_fixture',
  livemode: false,
  customer: 'cus_fixture',
  metadata: { billing_version: '2', purchaser_id: user, billing_intent_id: user },
  status,
  cancel_at_period_end: false,
  items: {
    data: [
      {
        price: { id: 'price_pro' },
        current_period_start: start / 1000,
        current_period_end: end / 1000,
      },
    ],
  },
  schedule: null,
});
describe('Stripe authoritative lifecycle', () => {
  it.each([
    { label: 'portal cancellation timestamp', cancelAt: end / 1000, legacy: false, expected: true },
    { label: 'legacy period-end flag', cancelAt: null, legacy: true, expected: true },
    { label: 'resumed subscription', cancelAt: null, legacy: false, expected: false },
    {
      label: 'cancellation after a later paid period',
      cancelAt: end / 1000 + 86400,
      legacy: false,
      expected: false,
    },
  ])('maps $label without changing paid-through access', async ({ cancelAt, legacy, expected }) => {
    mocks.subscriptions.retrieve.mockResolvedValue({
      ...subscription(),
      cancel_at: cancelAt,
      cancel_at_period_end: legacy,
    });
    expect((await loadStripeSnapshot('sub_fixture')).snapshot).toMatchObject({
      status: 'active',
      cancel_at_period_end: expected,
      current_period_end: new Date(end).toISOString(),
    });
  });

  it('recovers a missed refund webhook from the latest paid invoice', async () => {
    mocks.subscriptions.retrieve.mockResolvedValue({
      ...subscription(),
      latest_invoice: 'in_latest',
    });
    mocks.invoicePayments.list.mockResolvedValue({
      has_more: false,
      data: [{ payment: { payment_intent: 'pi_fixture' } }],
    });
    mocks.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_fixture', refunded: true, disputed: false },
    });
    expect((await loadStripeSnapshot('sub_fixture')).snapshot.status).toBe('refunded');
  });
  it('recovers a lost chargeback from provider state', async () => {
    mocks.subscriptions.retrieve.mockResolvedValue({
      ...subscription(),
      latest_invoice: 'in_latest',
    });
    mocks.invoicePayments.list.mockResolvedValue({
      has_more: false,
      data: [{ payment: { payment_intent: 'pi_fixture' } }],
    });
    mocks.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { id: 'ch_fixture', refunded: false, disputed: true },
    });
    mocks.disputes.list.mockResolvedValue({ has_more: false, data: [{ status: 'lost' }] });
    expect((await loadStripeSnapshot('sub_fixture')).snapshot.status).toBe('refunded');
  });

  it('ignores existing legacy checkout rather than creating a competing record', async () => {
    mocks.checkout.sessions.retrieve.mockResolvedValue({ metadata: {}, mode: 'subscription' });
    expect(await loadStripeCheckoutSnapshot('cs_legacy')).toBeNull();
  });
  it('bases failed-payment access on the last paid period', async () => {
    mocks.subscriptions.retrieve.mockResolvedValue(subscription('past_due'));
    mocks.invoices.list.mockResolvedValue({
      data: [
        {
          lines: {
            data: [
              {
                amount: 100,
                pricing: { price_details: { price: 'price_pro' } },
                period: { start: (start - 30 * 86400000) / 1000, end: start / 1000 },
              },
            ],
          },
        },
      ],
    });
    const { snapshot } = await loadStripeSnapshot('sub_fixture');
    expect(snapshot.current_period_end).toBe(new Date(start).toISOString());
    expect(snapshot.status).toBe('past_due');
  });
  it('does not grant an unpaid initial subscription', async () => {
    mocks.subscriptions.retrieve.mockResolvedValue(subscription('past_due'));
    mocks.invoices.list.mockResolvedValue({ data: [] });
    expect((await loadStripeSnapshot('sub_fixture')).snapshot.status).toBe('incomplete');
  });
  it('ignores an unpaid one-time checkout redirect', async () => {
    mocks.checkout.sessions.retrieve.mockResolvedValue({
      metadata: { billing_version: '2' },
      mode: 'payment',
      payment_status: 'unpaid',
    });
    expect(await loadStripeCheckoutSnapshot('cs_pending')).toBeNull();
  });
  it.each([
    ['needs_response', 'paused'],
    ['won', 'active'],
    ['lost', 'refunded'],
  ])('reconciles a one-time checkout with a %s dispute', async (dispute, expected) => {
    mocks.checkout.sessions.retrieve.mockResolvedValue({
      metadata: { billing_version: '2', purchaser_id: user, billing_intent_id: user },
      mode: 'payment',
      payment_status: 'paid',
      livemode: false,
      customer: 'cus_fixture',
      line_items: { data: [{ price: { id: 'price_once' } }] },
      payment_intent: {
        id: 'pi_fixture',
        status: 'succeeded',
        created: start / 1000,
        latest_charge: { id: 'ch_fixture', refunded: false, disputed: true },
      },
    });
    mocks.disputes.list.mockResolvedValue({ has_more: false, data: [{ status: dispute }] });
    expect((await loadStripeCheckoutSnapshot('cs_fixture'))?.snapshot.status).toBe(expected);
  });
  it('a refunded one-time charge cannot be restored as active', async () => {
    mocks.charges.retrieve.mockResolvedValue({
      livemode: false,
      customer: 'cus_fixture',
      refunded: true,
      payment_intent: {
        id: 'pi_fixture',
        created: start / 1000,
        metadata: {
          billing_version: '2',
          product_key: 'single_tryout_pro',
          purchaser_id: user,
          billing_intent_id: user,
        },
      },
    });
    expect((await stripeChargeSnapshots('ch_fixture', 'active'))[0]?.snapshot.status).toBe(
      'refunded',
    );
  });
  it('reflects scheduled subscription changes without prematurely granting the new tier', async () => {
    mocks.subscriptions.retrieve.mockResolvedValue({
      ...subscription(),
      schedule: { phases: [{ start_date: end / 1000, items: [{ price: 'price_org' }] }] },
    });
    expect((await loadStripeSnapshot('sub_fixture')).snapshot).toMatchObject({
      product_key: 'pro_monthly',
      pending_product_key: 'organization_monthly',
      downgrade_effective_at: new Date(end).toISOString(),
    });
  });
});
