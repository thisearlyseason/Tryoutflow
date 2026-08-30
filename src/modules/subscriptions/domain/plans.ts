import 'server-only';

import { z } from 'zod';

import { stripePriceIdSchema } from '../../../infrastructure/billing/billing-provider';

export const planKeySchema = z.enum(['trial', 'team', 'club', 'association']);
export type PlanKey = z.infer<typeof planKeySchema>;

export const paidPlanKeySchema = z.enum(['team', 'club', 'association']);
export type PaidPlanKey = z.infer<typeof paidPlanKeySchema>;

export const launchPlans = Object.freeze({
  trial: { key: 'trial', name: 'Trial', monthlyPriceCad: null },
  team: { key: 'team', name: 'Team', monthlyPriceCad: 49 },
  club: { key: 'club', name: 'Club', monthlyPriceCad: 129 },
  association: { key: 'association', name: 'Association', monthlyPriceCad: 249 },
} satisfies Record<PlanKey, { key: PlanKey; name: string; monthlyPriceCad: number | null }>);

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
