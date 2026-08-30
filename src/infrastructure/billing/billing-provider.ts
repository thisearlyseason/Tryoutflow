import { z } from 'zod';

import type { PaidPlanKey } from '../../modules/subscriptions/domain/plans';

export const billingProviderIdSchema = z
  .string()
  .regex(/^(?:cus|sub|price|cs_(?:test|live)|bps)_[A-Za-z0-9_]{8,200}$/u);

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
