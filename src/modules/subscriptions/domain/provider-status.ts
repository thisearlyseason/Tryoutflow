import type { BillingState } from './effective-entitlements';
/** Unknown provider states fail closed. Cancellation flags are separate from access state. */
export function normalizeSubscriptionStatus(
  provider: 'stripe' | 'revenuecat',
  status: string,
): BillingState {
  const mappings: Record<typeof provider, Record<string, BillingState>> = {
    stripe: {
      active: 'active',
      trialing: 'trialing',
      past_due: 'past_due',
      canceled: 'expired',
      unpaid: 'expired',
      paused: 'paused',
      incomplete: 'incomplete',
      incomplete_expired: 'expired',
    },
    revenuecat: {
      active: 'active',
      trial: 'trialing',
      grace_period: 'grace_period',
      billing_issue: 'past_due',
      cancelled: 'cancelled',
      expired: 'expired',
      refunded: 'refunded',
      paused: 'paused',
    },
  };
  return Object.hasOwn(mappings[provider], status) ? mappings[provider][status]! : 'incomplete';
}
