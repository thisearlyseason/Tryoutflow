import { z } from 'zod';
import {
  FEATURE_KEYS,
  UNCONFIGURED_LIMITS,
  resolveFeatureKey,
  type AccessTier,
  type FeatureKey,
  type UsageLimits,
} from './feature-catalog';

export const BILLING_STATES = [
  'active',
  'trialing',
  'grace_period',
  'past_due',
  'cancelled',
  'expired',
  'refunded',
  'paused',
  'incomplete',
] as const;
export type BillingState = (typeof BILLING_STATES)[number];
export type BillingSource =
  'free' | 'trial' | 'manual' | 'tryout_purchase' | 'organization_subscription' | 'legacy';
export const effectiveEntitlementsSchema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid().nullable(),
  plan: z.enum(['free', 'pro', 'organization']),
  source: z.enum([
    'free',
    'trial',
    'manual',
    'tryout_purchase',
    'organization_subscription',
    'legacy',
  ]),
  features: z.record(z.string(), z.boolean()),
  limits: z.object({
    active_tryouts: z.number().int().nonnegative().nullable(),
    athletes_per_tryout: z.number().int().nonnegative().nullable(),
    evaluators_per_tryout: z.number().int().nonnegative().nullable(),
    custom_templates: z.number().int().nonnegative().nullable(),
  }),
  evaluatedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});
export type EffectiveEntitlements = z.infer<typeof effectiveEntitlementsSchema>;
export type EntitlementGrant = {
  organizationId: string;
  tryoutId: string | null;
  tier: AccessTier;
  source: Exclude<BillingSource, 'free'>;
  features: readonly FeatureKey[];
  startsAt: string;
  expiresAt: string | null;
  revokedAt?: string | null;
  limits?: Partial<UsageLimits>;
};
const tierOrder: Record<AccessTier, number> = { free: 0, pro: 1, organization: 2 };
const sourceOrder: Record<BillingSource, number> = {
  free: 0,
  trial: 0,
  legacy: 1,
  organization_subscription: 2,
  tryout_purchase: 3,
  manual: 4,
};
/** Pure reference resolver for provider adapters/tests. Production access is resolved under RLS by SQL. */
export function resolveEffectiveEntitlements(input: {
  organizationId: string;
  tryoutId?: string | null;
  grants: readonly EntitlementGrant[];
  now: Date;
}): EffectiveEntitlements {
  const at = input.now.getTime();
  if (!Number.isFinite(at)) throw new Error('invalid_billing_clock');
  const active = input.grants.filter(
    (g) =>
      g.organizationId === input.organizationId &&
      (g.tryoutId === null || g.tryoutId === input.tryoutId) &&
      !g.revokedAt &&
      Number.isFinite(Date.parse(g.startsAt)) &&
      Date.parse(g.startsAt) <= at &&
      (g.expiresAt === null ||
        (Number.isFinite(Date.parse(g.expiresAt)) && Date.parse(g.expiresAt) > at)),
  );
  // Promotional grants add access; a lower temporary grant never removes paid features.
  active.sort(
    (a, b) =>
      tierOrder[b.tier] - tierOrder[a.tier] || sourceOrder[b.source] - sourceOrder[a.source],
  );
  const best = active[0];
  const features = Object.fromEntries(
    FEATURE_KEYS.map((key) => [
      key,
      key === 'create_tryout' ||
        key === 'basic_evaluations' ||
        active.some((g) => g.features.includes(key)),
    ]),
  );
  const limits = { ...UNCONFIGURED_LIMITS };
  for (const key of Object.keys(limits) as (keyof UsageLimits)[]) {
    const configured = active
      .map((g) => g.limits?.[key])
      .filter((v): v is number | null => v !== undefined);
    if (configured.length)
      limits[key] = configured.some((v) => v === null)
        ? null
        : Math.max(...(configured as number[]));
  }
  return {
    organizationId: input.organizationId,
    tryoutId: input.tryoutId ?? null,
    plan: best?.tier ?? 'free',
    source: best?.source ?? 'free',
    features,
    limits,
    evaluatedAt: input.now.toISOString(),
    expiresAt: best?.expiresAt ?? null,
  };
}
export function hasEntitlement(entitlements: EffectiveEntitlements, feature: string): boolean {
  const key = resolveFeatureKey(feature);
  return key !== null && entitlements.features[key] === true;
}
export function subscriptionAccessEnd(input: {
  state: BillingState;
  currentPeriodEnd: string | null;
  gracePeriodEnd?: string | null;
  trialEnd?: string | null;
  now: Date;
}): string | null {
  if (!['active', 'trialing', 'grace_period', 'cancelled', 'past_due'].includes(input.state))
    return null;
  const boundary =
    input.state === 'trialing'
      ? (input.trialEnd ?? input.currentPeriodEnd)
      : input.state === 'grace_period' || input.state === 'past_due'
        ? ([input.gracePeriodEnd, input.currentPeriodEnd]
            .filter((value): value is string => !!value)
            .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null)
        : input.currentPeriodEnd;
  return boundary !== null && Date.parse(boundary) > input.now.getTime() ? boundary : null;
}
