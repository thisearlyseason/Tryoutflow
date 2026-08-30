import { createServerSupabaseClient } from '../../../../../infrastructure/supabase/server';
import { createAdminSupabaseClient } from '../../../../../infrastructure/supabase/admin';
import { parseOrganizationId, parseUserId, type OrganizationId } from '../../../../../lib/ids';
import { getBillingEnvironment, getPublicAppOrigin } from '../../../../../lib/env';
import { SupabaseMembershipRepository } from '../../../../../modules/organizations/infrastructure/membership-repository';
import type { BillingRouteDependencies } from '../../../../../modules/subscriptions/application/billing-route-boundary';
import { getStripePriceMapping } from '../../../../../modules/subscriptions/domain/plans';
import { loadOwnedSubscriptionAccount } from '../../../../../modules/subscriptions/infrastructure/owned-subscription-account';
import { createSubscriptionCheckoutIntentStore } from '../../../../../modules/subscriptions/infrastructure/subscription-checkout-intent-store';
import { StripeBillingProvider } from '../../../../../infrastructure/billing/stripe-provider';

export async function createBillingRouteDependencies(): Promise<BillingRouteDependencies> {
  const client = await createServerSupabaseClient();
  const environment = getBillingEnvironment();
  const checkoutIntents = createSubscriptionCheckoutIntentStore(
    client,
    createAdminSupabaseClient(),
  );
  return {
    canonicalOrigin: getPublicAppOrigin(),
    provider: new StripeBillingProvider({ secretKey: environment.STRIPE_SECRET_KEY }),
    prices: getStripePriceMapping(),
    async authenticate(organizationId: OrganizationId) {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) return null;
      const actor = await new SupabaseMembershipRepository(client).findAuthorizationContext(
        parseUserId(user.id),
        organizationId,
      );
      if (!actor || actor.organizationRole !== 'owner') return null;
      const organization = await client
        .from('organizations')
        .select('id,slug')
        .eq('id', organizationId)
        .maybeSingle();
      if (organization.error || !organization.data) return null;
      if (parseOrganizationId(organization.data.id) !== organizationId) return null;
      return { actor, organizationSlug: organization.data.slug };
    },
    loadOwnedAccount: (organizationId) => loadOwnedSubscriptionAccount(client, organizationId),
    checkoutIntents,
  };
}
