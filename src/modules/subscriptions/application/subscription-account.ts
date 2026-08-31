import { z } from 'zod';

import type { OrganizationId } from '../../../lib/ids';
import { planKeySchema, type PlanKey } from '../domain/plans';
import { type SubscriptionState } from '../domain/entitlements';

export type SubscriptionAccount = Readonly<{
  organizationId: OrganizationId;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerPriceId: string | null;
  plan: PlanKey | null;
  state: SubscriptionState;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  cancelAt: string | null;
  canceledAt: string | null;
  trialEnd: string | null;
  verifiedAt: string;
  version: number;
}>;

export const subscriptionAccountRowSchema = z
  .object({
    organization_id: z.uuid(),
    provider_customer_id: z.string().nullable(),
    provider_subscription_id: z.string().nullable(),
    provider_price_id: z.string().nullable(),
    plan_key: planKeySchema.nullable(),
    state: z.enum(['inactive', 'trialing', 'active', 'past_due', 'canceled']),
    current_period_start: z.iso.datetime({ offset: true }).nullable(),
    current_period_end: z.iso.datetime({ offset: true }).nullable(),
    cancel_at_period_end: z.boolean().nullable(),
    cancel_at: z.iso.datetime({ offset: true }).nullable(),
    canceled_at: z.iso.datetime({ offset: true }).nullable(),
    trial_end: z.iso.datetime({ offset: true }).nullable(),
    verified_at: z.iso.datetime({ offset: true }),
    version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
