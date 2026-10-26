import { describe, expect, it } from 'vitest';
import { stripeCheckoutIdentity } from '@/modules/subscriptions/providers/stripe-checkout-identity';
const attempt = '1b9d3acd-487a-4f2c-8ad6-01fc271c9c43';
describe('Stripe checkout protocol identities', () => {
  it('preserves old unresolved reservation payload and key', () => {
    expect(stripeCheckoutIdentity(attempt)).toEqual({
      intentId: attempt,
      idempotencyKey: `billing_v2_${attempt}`,
      parameters: {},
    });
  });
  it('pins new checkout to standard mode with a distinct stable reservation and key', () => {
    const fresh = stripeCheckoutIdentity(attempt, 'standard_v1');
    expect(fresh.parameters).toEqual({ managed_payments: { enabled: false } });
    expect(fresh.intentId).not.toBe(attempt);
    expect(fresh.idempotencyKey).not.toBe(stripeCheckoutIdentity(attempt).idempotencyKey);
    expect(fresh).toEqual(stripeCheckoutIdentity(attempt, 'standard_v1'));
    expect(fresh.intentId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  });
  it('keeps separate attempts separate', () => {
    expect(stripeCheckoutIdentity(attempt, 'standard_v1').intentId).not.toBe(
      stripeCheckoutIdentity('2b9d3acd-487a-4f2c-8ad6-01fc271c9c43', 'standard_v1').intentId,
    );
  });
});
