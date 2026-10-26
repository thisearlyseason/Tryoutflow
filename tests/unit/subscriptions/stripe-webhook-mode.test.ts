import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  construct: vi.fn(),
  delivery: vi.fn(),
  apply: vi.fn(),
  checkout: vi.fn(),
  load: vi.fn(),
  snapshots: vi.fn(),
  subscription: vi.fn(),
  charge: vi.fn(),
  dispute: vi.fn(),
}));
vi.mock('@/modules/subscriptions/application/billing-delivery', () => ({
  withBillingDelivery: m.delivery,
}));
vi.mock('@/modules/subscriptions/application/billing-service', () => ({
  applyBillingSnapshot: m.apply,
}));
vi.mock('@/modules/subscriptions/providers/stripe', () => ({
  stripeBillingClient: () => ({
    webhooks: { constructEventAsync: m.construct },
    subscriptions: { retrieve: m.subscription },
    charges: { retrieve: m.charge },
    disputes: { retrieve: m.dispute },
  }),
  loadStripeSnapshot: m.load,
  loadStripeCheckoutSnapshot: m.checkout,
  stripeChargeSnapshots: m.snapshots,
}));
import { POST } from '@/app/api/webhooks/billing/stripe/route';
const request = () =>
  new Request('https://www.tryout.agency/api/webhooks/billing/stripe', {
    method: 'POST',
    body: '{}',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
    },
  });
function event(type: string, livemode: boolean) {
  m.construct.mockResolvedValue({
    id: 'evt_fixture',
    type,
    livemode,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: type.startsWith('invoice.')
        ? { id: 'in_fixture', parent: { subscription_details: { subscription: 'sub_fixture' } } }
        : { id: 'provider_fixture' },
    },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('BILLING_ENVIRONMENT', 'production');
  vi.stubEnv('STRIPE_BILLING_WEBHOOK_SECRET', 'whsec_local_fixture');
  m.delivery.mockImplementation(async (_: unknown, callback: () => Promise<Response>) =>
    callback(),
  );
  m.apply.mockResolvedValue('applied');
  m.checkout.mockResolvedValue({
    snapshot: { provider_contract_id: 'pi_fixture' },
    intentId: 'intent_fixture',
  });
  m.load.mockResolvedValue({
    snapshot: { provider_contract_id: 'sub_fixture' },
    intentId: 'intent_fixture',
  });
  m.subscription.mockResolvedValue({ metadata: { billing_version: '2' } });
  m.charge.mockResolvedValue({ id: 'ch_fixture', refunded: true });
  m.dispute.mockResolvedValue({ charge: 'ch_fixture', status: 'lost' });
  m.snapshots.mockResolvedValue([
    { snapshot: { provider_contract_id: 'pi_fixture' }, intentId: 'intent_fixture' },
  ]);
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['production', false],
  ['sandbox', true],
] as const)('rejects opposite mode before delivery/provider reads: %s', async (mode, live) => {
  vi.stubEnv('BILLING_ENVIRONMENT', mode);
  event('invoice.paid', live);
  expect((await POST(request())).status).toBe(400);
  expect(m.delivery).not.toHaveBeenCalled();
  expect(m.subscription).not.toHaveBeenCalled();
  expect(m.apply).not.toHaveBeenCalled();
});
it('rejects missing mode before recording', async () => {
  event('invoice.paid', true);
  const e = await m.construct();
  delete e.livemode;
  expect((await POST(request())).status).toBe(400);
  expect(m.delivery).not.toHaveBeenCalled();
});
it.each([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
])('routes approved event to authoritative state: %s', async (type) => {
  event(type, true);
  expect((await POST(request())).status).toBe(200);
  expect(m.delivery).toHaveBeenCalledOnce();
  expect(m.apply).toHaveBeenCalledOnce();
  if (type.startsWith('invoice.') || type.startsWith('customer.subscription.'))
    expect(m.load).toHaveBeenCalledOnce();
  if (type.startsWith('checkout.')) expect(m.checkout).toHaveBeenCalledOnce();
  if (type.startsWith('charge.')) expect(m.snapshots).toHaveBeenCalledOnce();
});
it('does not grant unpaid async checkout', async () => {
  event('checkout.session.completed', true);
  m.checkout.mockResolvedValue(null);
  expect(await (await POST(request())).json()).toEqual({ outcome: 'payment_pending' });
  expect(m.apply).not.toHaveBeenCalled();
});
it('retains partial refund based on retrieved state', async () => {
  event('charge.refunded', true);
  m.charge.mockResolvedValue({ id: 'ch_fixture', refunded: false });
  expect(await (await POST(request())).json()).toEqual({ outcome: 'partial_refund_retained' });
  expect(m.apply).not.toHaveBeenCalled();
});
it('restores won dispute from authoritative snapshots', async () => {
  event('charge.dispute.closed', true);
  m.dispute.mockResolvedValue({ charge: 'ch_fixture', status: 'won' });
  expect((await POST(request())).status).toBe(200);
  expect(m.snapshots).toHaveBeenCalledWith('ch_fixture', 'active');
  expect(m.apply.mock.calls[0]?.[0].type).toBe('subscription_revocation_reversed');
});
it('expiration does not grant access', async () => {
  event('checkout.session.expired', true);
  expect(await (await POST(request())).json()).toEqual({ outcome: 'ignored' });
  expect(m.apply).not.toHaveBeenCalled();
});
it('provider interruption fails without completion', async () => {
  event('invoice.paid', true);
  m.load.mockRejectedValue(new Error('interrupted'));
  expect((await POST(request())).status).toBe(503);
  expect(m.apply).not.toHaveBeenCalled();
});
