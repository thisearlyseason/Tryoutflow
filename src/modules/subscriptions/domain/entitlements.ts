import type { PlanKey } from './plans';

export type SubscriptionState = 'inactive' | 'trialing' | 'active' | 'past_due' | 'canceled';

export type Entitlements = Readonly<{
  canPublishTryout: boolean;
  canManageExistingTryouts: boolean;
}>;

export function entitlementsFor(input: {
  plan: PlanKey | null;
  state: SubscriptionState;
}): Entitlements {
  const recognizedPlan = input.plan !== null;
  return Object.freeze({
    canPublishTryout: recognizedPlan && (input.state === 'trialing' || input.state === 'active'),
    // Billing problems must not lock an organization out of its existing operational records.
    canManageExistingTryouts: recognizedPlan,
  });
}
