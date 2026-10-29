import 'server-only';
import type { providerContext } from './billing-service';

type Context = Awaited<ReturnType<typeof providerContext>>;
type Scope = {
  organizationId: string;
  purchaserId: string;
  provider: 'apple' | 'google';
  productKey: string;
  tryoutId: string | null;
};

/** Reuse the original reservation after a device change; never extend or replace it. */
export async function resumeNativePurchase({
  context,
  scope,
  hasLegacySubscription,
  reserve,
}: {
  context: Context;
  scope: Scope;
  hasLegacySubscription: () => Promise<boolean>;
  reserve: (id: string) => Promise<unknown>;
}): Promise<string | null> {
  const now = Date.now();
  const matches = context.intents.filter(
    (intent) =>
      intent.organization_id === scope.organizationId &&
      intent.purchaser_id === scope.purchaserId &&
      intent.provider === scope.provider &&
      intent.product_key === scope.productKey &&
      intent.tryout_id === scope.tryoutId &&
      intent.contract_id === null &&
      !intent.provider_session_id &&
      Date.parse(intent.expires_at) > now,
  );
  const pendingInOrganization = context.intents.filter(
    (intent) =>
      intent.organization_id === scope.organizationId &&
      intent.contract_id === null &&
      Date.parse(intent.expires_at) > now,
  );
  if (matches.length !== 1 || pendingInOrganization.length !== 1) return null;
  // Same-id RPC retries are idempotent. Do not use that path to bypass an
  // intervening active subscription or a completed purchase.
  if (
    context.contracts.some(
      (contract) =>
        contract.organization_id === scope.organizationId &&
        contract.environment === context.environment &&
        (contract.tryout_id === null || contract.tryout_id === scope.tryoutId) &&
        contract.status !== 'expired' &&
        (contract.current_period_end === null ||
          Math.max(
            Date.parse(contract.current_period_end),
            Date.parse(contract.grace_period_end ?? contract.current_period_end),
          ) > now),
    ) ||
    (await hasLegacySubscription())
  )
    return null;
  const intent = matches[0]!;
  // Run the authenticated database reservation again, retaining its ownership,
  // environment, concurrent-checkout and event eligibility checks.
  const resumed = (await reserve(intent.id)) as Record<string, unknown> | null;
  if (
    !resumed ||
    resumed.id !== intent.id ||
    resumed.organization_id !== scope.organizationId ||
    resumed.purchaser_id !== scope.purchaserId ||
    resumed.provider !== scope.provider ||
    resumed.product_key !== scope.productKey ||
    resumed.tryout_id !== scope.tryoutId ||
    resumed.environment !== context.environment ||
    resumed.contract_id !== null ||
    resumed.expires_at !== intent.expires_at ||
    Date.parse(intent.expires_at) <= Date.now()
  )
    return null;
  return intent.id;
}
