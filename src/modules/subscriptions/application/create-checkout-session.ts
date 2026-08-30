import { z } from 'zod';

import {
  isBillingProviderError,
  type BillingProvider,
} from '../../../infrastructure/billing/billing-provider';
import { failure, success, type AppResult } from '../../../lib/result';
import type { OrganizationId } from '../../../lib/ids';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { paidPlanKeySchema, type StripePriceMapping } from '../domain/plans';
import {
  billingPageUrl,
  currentOwnerMatches,
  parseProviderSession,
  validateBillingOrigin,
  type BillingSessionError,
  type OwnedAccountLoader,
} from './billing-session-shared';
import type { SubscriptionAccount } from './subscription-account';
import type { CheckoutIntentStore } from './checkout-intent';

type CheckoutInput = Readonly<{
  organizationId: OrganizationId;
  organizationSlug: string;
  plan: unknown;
  clientAttemptId: unknown;
  origin: string;
}>;

type CheckoutDependencies = Readonly<{
  provider: BillingProvider;
  prices: StripePriceMapping;
  loadOwnedAccount: OwnedAccountLoader;
  checkoutIntents: CheckoutIntentStore;
}>;

export async function createCheckoutSession(
  input: CheckoutInput,
  actor: AuthorizationContext,
  dependencies: CheckoutDependencies,
): Promise<AppResult<Readonly<{ sessionId: string; url: string }>, BillingSessionError>> {
  const plan = paidPlanKeySchema.safeParse(input.plan);
  if (!plan.success) return failure({ code: 'invalid_plan' });
  const attempt = z.uuid().safeParse(input.clientAttemptId);
  if (!attempt.success || attempt.data === '00000000-0000-0000-0000-000000000000')
    return failure({ code: 'invalid_attempt' });
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
  let reservation;
  try {
    reservation = await dependencies.checkoutIntents.reserve({
      organizationId: input.organizationId,
      initiatingOwnerUserId: actor.userId,
      clientAttemptId: attempt.data,
      plan: plan.data,
    });
  } catch {
    return failure({ code: 'billing_unavailable' });
  }
  if (reservation.outcome === 'forbidden') return failure({ code: 'forbidden' });
  if (reservation.outcome === 'subscription_exists')
    return failure({ code: 'subscription_exists' });
  if (reservation.outcome === 'in_progress' || reservation.outcome === 'conflict')
    return failure({ code: 'checkout_in_progress' });
  if (reservation.outcome === 'completed') {
    const replay = parseProviderSession(
      { sessionId: reservation.sessionId, url: reservation.resultUrl },
      'checkout',
    );
    return replay.success ? success(replay.data) : failure({ code: 'billing_unavailable' });
  }
  if (!['reserved', 'pending'].includes(reservation.outcome) || reservation.idempotencyKey === null)
    return failure({ code: 'billing_unavailable' });
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
      reservation.idempotencyKey,
    );
    const parsed = parseProviderSession(result, 'checkout');
    if (!parsed.success) return failure({ code: 'billing_unavailable' });
    const settled = await dependencies.checkoutIntents.complete({
      organizationId: input.organizationId,
      clientAttemptId: attempt.data,
      sessionId: parsed.data.sessionId,
      resultUrl: parsed.data.url,
    });
    return settled === 'completed'
      ? success(parsed.data)
      : failure({ code: 'billing_unavailable' });
  } catch (error) {
    if (
      isBillingProviderError(error) &&
      (error.code === 'provider_rejected' || error.code === 'provider_configuration')
    ) {
      try {
        await dependencies.checkoutIntents.fail({
          organizationId: input.organizationId,
          clientAttemptId: attempt.data,
        });
      } catch {
        // The provider failed permanently; a failed cleanup remains fail-closed until expiry.
      }
    }
    return failure({ code: 'billing_unavailable' });
  }
}
