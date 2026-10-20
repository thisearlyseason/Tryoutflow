import 'server-only';

import { z } from 'zod';

import { stripePriceIdSchema } from '../../../infrastructure/billing/billing-provider';
import { PLAN_CATALOG } from './plan-catalog';

export { PLAN_CATALOG } from './plan-catalog';

export const planKeySchema = z.enum(['trial', 'team', 'club', 'association']);
export type PlanKey = z.infer<typeof planKeySchema>;

export const paidPlanKeySchema = z.enum(['team', 'club', 'association']);
export type PaidPlanKey = z.infer<typeof paidPlanKeySchema>;

/** Backwards-compatible name for authenticated billing surfaces. */
export const launchPlans = PLAN_CATALOG;

const stripePriceEnvironmentSchema = z
  .object({
    STRIPE_PRICE_TEAM: stripePriceIdSchema,
    STRIPE_PRICE_CLUB: stripePriceIdSchema,
    STRIPE_PRICE_ASSOCIATION: stripePriceIdSchema,
  })
  .refine(
    (value) => new Set(Object.values(value)).size === 3,
    'Stripe price IDs must map to exactly one plan',
  );

export type StripePriceMapping = Readonly<Record<PaidPlanKey, string>>;

export function getStripePriceMapping(
  environment: Record<string, string | undefined> = process.env,
): StripePriceMapping {
  if (typeof window !== 'undefined') throw new Error('Stripe configuration is server-only');
  const parsed = stripePriceEnvironmentSchema.parse(environment);
  return Object.freeze({
    team: parsed.STRIPE_PRICE_TEAM,
    club: parsed.STRIPE_PRICE_CLUB,
    association: parsed.STRIPE_PRICE_ASSOCIATION,
  });
}

export function planForStripePrice(
  priceId: string,
  mapping: StripePriceMapping,
): PaidPlanKey | null {
  const match = (Object.entries(mapping) as [PaidPlanKey, string][]).find(
    ([, configured]) => configured === priceId,
  );
  return match?.[0] ?? null;
}
