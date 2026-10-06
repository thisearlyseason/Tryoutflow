import { beforeEach, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { resumePendingStripeCheckout } from '@/modules/subscriptions/providers/stripe-checkout-resume';
const retrieve = vi.fn();
const intent = {
  id: 'intent_fixture',
  organization_id: 'org_fixture',
  purchaser_id: 'owner_fixture',
  tryout_id: null,
  provider: 'stripe',
  product_key: 'pro_monthly',
  contract_id: null,
  expires_at: new Date(Date.now() + 60000).toISOString(),
  provider_session_id: 'cs_test_fixture',
};
const session = {
  id: 'cs_test_fixture',
  status: 'open',
  payment_status: 'unpaid',
  livemode: false,
  mode: 'subscription',
  expires_at: Math.floor(Date.now() / 1000) + 60,
  client_reference_id: intent.id,
  metadata: {
    billing_version: '2',
    billing_intent_id: intent.id,
    organization_id: intent.organization_id,
    purchaser_id: intent.purchaser_id,
    product_key: intent.product_key,
  },
  line_items: { has_more: false, data: [{ price: { id: 'price_fixture' }, quantity: 1 }] },
  url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
};
const options = () => ({
  stripe: { checkout: { sessions: { retrieve } } } as unknown as Pick<Stripe, 'checkout'>,
  intents: [{ ...intent }],
  organizationId: intent.organization_id,
  purchaserId: intent.purchaser_id,
  productKey: intent.product_key,
  tryoutId: null,
  priceId: 'price_fixture',
  environment: 'sandbox' as const,
  mode: 'subscription' as const,
});
beforeEach(() => {
  retrieve.mockReset();
  retrieve.mockResolvedValue(structuredClone(session));
});
it('resumes exact open unpaid checkout without creating another provider object', async () => {
  expect(await resumePendingStripeCheckout(options())).toBe(session.url);
  expect(retrieve).toHaveBeenCalledOnce();
  expect(retrieve).toHaveBeenCalledWith(intent.provider_session_id, { expand: ['line_items'] });
});
it.each([
  { purchaser_id: 'other' },
  { organization_id: 'other' },
  { product_key: 'organization_monthly' },
  { tryout_id: 'other_event' },
  { provider: 'apple' },
  { contract_id: 'paid_contract' },
  { expires_at: new Date(0).toISOString() },
  { provider_session_id: null },
])('does not read a checkout outside exact pending attribution: %j', async (change) => {
  const o = options();
  Object.assign(o.intents[0]!, change);
  expect(await resumePendingStripeCheckout(o)).toBeNull();
  expect(retrieve).not.toHaveBeenCalled();
});
it('rejects ambiguous matching intents before provider access', async () => {
  const o = options();
  o.intents.push({ ...intent, id: 'second' });
  expect(await resumePendingStripeCheckout(o)).toBeNull();
  expect(retrieve).not.toHaveBeenCalled();
});
it.each([
  { status: 'complete' },
  { status: 'expired' },
  { payment_status: 'paid' },
  { livemode: true },
  { mode: 'payment' },
  { expires_at: 1 },
  { client_reference_id: 'other' },
  { metadata: { ...session.metadata, purchaser_id: 'other' } },
  { metadata: { ...session.metadata, organization_id: 'other' } },
  { metadata: { ...session.metadata, billing_intent_id: 'other' } },
  { metadata: { ...session.metadata, product_key: 'organization_monthly' } },
  { metadata: { ...session.metadata, tryout_id: 'other' } },
  { metadata: { ...session.metadata, billing_version: '1' } },
  { line_items: { has_more: true, data: session.line_items.data } },
  { line_items: { has_more: false, data: [{ price: { id: 'other_price' }, quantity: 1 }] } },
  { line_items: { has_more: false, data: [{ price: { id: 'price_fixture' }, quantity: 2 }] } },
  { url: 'https://attacker.invalid/pay' },
  { url: 'http://checkout.stripe.com/pay' },
  { url: 'https://user:pass@checkout.stripe.com/pay' },
])('rejects provider session mismatch: %j', async (change) => {
  retrieve.mockResolvedValue({ ...structuredClone(session), ...change });
  expect(await resumePendingStripeCheckout(options())).toBeNull();
});
it('propagates provider interruption so route fails honestly', async () => {
  retrieve.mockRejectedValue(new Error('offline'));
  await expect(resumePendingStripeCheckout(options())).rejects.toThrow('offline');
});
