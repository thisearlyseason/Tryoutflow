import type { ReactNode } from 'react';
import { getEffectiveEntitlements } from '../application/billing-service';
import type { FeatureKey } from '../domain/feature-catalog';
import { hasEntitlement } from '../domain/effective-entitlements';
import { FeatureGate } from './feature-gate';
export async function billingUpgradePrompt(
  organizationId: string,
  organizationSlug: string,
  feature: FeatureKey,
  tryoutId: string | null = null,
): Promise<ReactNode | null> {
  if (!process.env.BILLING_ENVIRONMENT) return null;
  const access = await getEffectiveEntitlements(organizationId, tryoutId);
  return hasEntitlement(access, feature) ? null : (
    <FeatureGate
      access={access}
      feature={feature}
      billingHref={`/app/${organizationSlug}/organization/billing`}
    >
      {null}
    </FeatureGate>
  );
}
