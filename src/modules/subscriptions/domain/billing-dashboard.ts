import { z } from 'zod';
import { effectiveEntitlementsSchema, BILLING_STATES } from './effective-entitlements';
export const billingDashboardSchema = z.object({
  access: effectiveEntitlementsSchema,
  purchasesEnabled: z.boolean().optional(),
  trial: z
    .object({
      eligible: z.boolean(),
      startsAt: z.string().nullable(),
      expiresAt: z.string().nullable(),
    })
    .optional(),
  subscriptions: z.array(
    z.object({
      id: z.uuid(),
      tryout_id: z.uuid().nullable(),
      product_key: z.string(),
      provider: z.enum(['stripe', 'apple', 'google']),
      status: z.enum(BILLING_STATES),
      current_period_start: z.string(),
      current_period_end: z.string().nullable(),
      cancel_at_period_end: z.boolean(),
      pending_product_key: z.string().nullable(),
      downgrade_effective_at: z.string().nullable(),
    }),
  ),
  overrides: z.array(
    z.object({
      id: z.uuid(),
      product_key: z.string(),
      reason: z.string(),
      starts_at: z.string(),
      expires_at: z.string(),
      revoked_at: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({ event_type: z.string(), created_at: z.string(), metadata: z.unknown() }),
  ),
  usage: z.object({ active_tryouts: z.number() }),
});
export type BillingDashboard = z.infer<typeof billingDashboardSchema>;
export type AvailableBillingProduct = {
  key: string;
  name: string;
  price: string;
  interval: string | null;
  features: string[];
};
