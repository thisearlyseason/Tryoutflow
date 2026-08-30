import { z } from 'zod';

import type { BillingProvider } from '../../../infrastructure/billing/billing-provider';
import { failure, success, type AppResult } from '../../../lib/result';
import type { OrganizationId } from '../../../lib/ids';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { paidPlanKeySchema, type StripePriceMapping } from '../domain/plans';
import {
  billingPageUrl,
  currentOwnerMatches,
  parseProviderSession,
  stableBillingIdempotencyKey,
  validateBillingOrigin,
  type BillingSessionError,
  type OwnedAccountLoader,
} from './billing-session-shared';
import type { SubscriptionAccount } from './subscription-account';

type CheckoutInput = Readonly<{
  organizationId: OrganizationId;
  organizationSlug: string;
  plan: unknown;
  origin: string;
}>;

type CheckoutDependencies = Readonly<{
  provider: BillingProvider;
  prices: StripePriceMapping;
  loadOwnedAccount: OwnedAccountLoader;
}>;

export async function createCheckoutSession(
  input: CheckoutInput,
  actor: AuthorizationContext,
  dependencies: CheckoutDependencies,
): Promise<AppResult<Readonly<{ sessionId: string; url: string }>, BillingSessionError>> {
  const plan = paidPlanKeySchema.safeParse(input.plan);
  if (!plan.success) return failure({ code: 'invalid_plan' });
  const origin = validateBillingOrigin(input.origin);
  if (
    !origin ||
    !z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .safeParse(input.organizationSlug).success
  )
    return failure({ code: 'invalid_return_url' });
  if (!currentOwnerMatches(actor, input.organizationId)) return failure({ code: 'forbidden' });
  let account: SubscriptionAccount | null;
  try {
    account = await dependencies.loadOwnedAccount(input.organizationId, actor.userId);
  } catch {
    return failure({ code: 'billing_unavailable' });
  }
  if (!account || account.organizationId !== input.organizationId)
    return failure({ code: 'forbidden' });
  if (
    account.providerSubscriptionId !== null &&
    (account.state === 'trialing' || account.state === 'active' || account.state === 'past_due')
  )
    return failure({ code: 'subscription_exists' });
  const priceId = dependencies.prices[plan.data];
  if (!priceId) return failure({ code: 'invalid_plan' });
  try {
    const result = await dependencies.provider.createCheckoutSession(
      {
        organizationId: input.organizationId,
        plan: plan.data,
        priceId,
        successUrl: billingPageUrl(origin, input.organizationSlug, 'checkout=complete'),
        cancelUrl: billingPageUrl(origin, input.organizationSlug, 'checkout=cancelled'),
        ...(account.providerCustomerId ? { customerId: account.providerCustomerId } : {}),
      },
      stableBillingIdempotencyKey([
        'checkout',
        input.organizationId,
        origin,
        input.organizationSlug,
        plan.data,
        account.version,
      ]),
    );
    const parsed = parseProviderSession(result);
    return parsed.success ? success(parsed.data) : failure({ code: 'billing_unavailable' });
  } catch {
    return failure({ code: 'billing_unavailable' });
  }
}
