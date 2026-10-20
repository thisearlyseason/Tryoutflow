import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import { parseOrganizationId, type OrganizationId } from '../../../lib/ids';
import {
  subscriptionAccountRowSchema,
  type SubscriptionAccount,
} from '../application/subscription-account';

export async function loadOwnedSubscriptionAccount(
  client: SupabaseClient<Database>,
  organizationId: OrganizationId,
): Promise<SubscriptionAccount | null> {
  const result = await client.rpc('get_owned_subscription_account', {
    p_organization_id: organizationId,
  });
  if (result.error) throw new Error('subscription_account_lookup_failed');
  const row = result.data[0];
  if (!row) return null;
  const parsed = subscriptionAccountRowSchema.parse(row);
  return {
    organizationId: parseOrganizationId(parsed.organization_id),
    providerCustomerId: parsed.provider_customer_id,
    providerSubscriptionId: parsed.provider_subscription_id,
    providerPriceId: parsed.provider_price_id,
    plan: parsed.plan_key,
    state: parsed.state,
    currentPeriodStart: parsed.current_period_start,
    currentPeriodEnd: parsed.current_period_end,
    cancelAtPeriodEnd: parsed.cancel_at_period_end,
    cancelAt: parsed.cancel_at,
    canceledAt: parsed.canceled_at,
    trialEnd: parsed.trial_end,
    verifiedAt: parsed.verified_at,
    version: parsed.version,
  };
}
