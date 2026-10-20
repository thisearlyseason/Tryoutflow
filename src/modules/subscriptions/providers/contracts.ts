import { z } from 'zod';
import { BILLING_STATES } from '../domain/effective-entitlements';
export const billingSnapshotSchema = z.object({
  provider: z.enum(['stripe', 'apple', 'google']),
  environment: z.enum(['sandbox', 'production']),
  provider_contract_id: z.string().min(1).max(512),
  provider_customer_id: z.string().min(1).max(512),
  purchaser_id: z.uuid(),
  product_key: z.enum([
    'pro_monthly',
    'pro_annual',
    'organization_monthly',
    'organization_annual',
    'single_tryout_pro',
  ]),
  status: z.enum(BILLING_STATES),
  purchase_started_at: z.iso.datetime({ offset: true }).optional(),
  current_period_start: z.iso.datetime({ offset: true }),
  current_period_end: z.iso.datetime({ offset: true }).nullable(),
  grace_period_end: z.iso.datetime({ offset: true }).nullable().default(null),
  cancel_at_period_end: z.boolean().default(false),
  pending_product_key: z
    .enum([
      'pro_monthly',
      'pro_annual',
      'organization_monthly',
      'organization_annual',
      'single_tryout_pro',
    ])
    .nullable()
    .default(null),
  downgrade_effective_at: z.iso.datetime({ offset: true }).nullable().default(null),
  observed_at: z.iso.datetime({ offset: true }),
});
export type BillingSnapshot = z.infer<typeof billingSnapshotSchema>;
export type BillingReceipt = {
  provider: string;
  id: string;
  type: string;
  digest: string;
  occurred_at: string;
};
