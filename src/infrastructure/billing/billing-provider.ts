import { z } from 'zod';

import type { PaidPlanKey } from '../../modules/subscriptions/domain/plans';
import { isValidBillingSessionId } from './provider-session-url';

const stripeIdentifierSuffix = '[A-Za-z0-9]{8,200}';
export const stripeEventIdSchema = z.string().regex(new RegExp(`^evt_${stripeIdentifierSuffix}$`));
export const stripeCustomerIdSchema = z
  .string()
  .regex(new RegExp(`^cus_${stripeIdentifierSuffix}$`));
export const stripeSubscriptionIdSchema = z
  .string()
  .regex(new RegExp(`^sub_${stripeIdentifierSuffix}$`));
export const stripePriceIdSchema = z
  .string()
  .regex(new RegExp(`^price_${stripeIdentifierSuffix}$`));

export const billingProviderIdSchema = z
  .string()
  .refine(
    (value) =>
      /^(?:cus|sub|price)_[A-Za-z0-9]{8,200}$/u.test(value) ||
      isValidBillingSessionId(value, 'checkout') ||
      isValidBillingSessionId(value, 'portal'),
  );

export type BillingProviderError = Readonly<{
  code:
    'provider_temporary' | 'provider_rejected' | 'provider_configuration' | 'delivery_uncertain';
  retryable: boolean;
}>;

export type CheckoutSessionInput = Readonly<{
  organizationId: string;
  plan: PaidPlanKey;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
}>;

export type PortalSessionInput = Readonly<{
  organizationId: string;
  customerId: string;
  returnUrl: string;
}>;

export interface BillingProvider {
  createCheckoutSession(
    input: CheckoutSessionInput,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ sessionId: string; url: string }>;
  createPortalSession(
    input: PortalSessionInput,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ sessionId: string; url: string }>;
}

export function isBillingProviderError(error: unknown): error is BillingProviderError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    [
      'provider_temporary',
      'provider_rejected',
      'provider_configuration',
      'delivery_uncertain',
    ].includes(String((error as { code: unknown }).code)) &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean'
  );
}
