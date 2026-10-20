import { createServerSupabaseClient } from '../../../../../infrastructure/supabase/server';
import { createAdminSupabaseClient } from '../../../../../infrastructure/supabase/admin';
import { parseOrganizationId, parseUserId, type OrganizationId } from '../../../../../lib/ids';
import { getBillingEnvironment, getPublicAppOrigin } from '../../../../../lib/env';
import { SupabaseMembershipRepository } from '../../../../../modules/organizations/infrastructure/membership-repository';
import type {
  BillingRouteDependencies,
  BillingPortalRouteDependencies,
} from '../../../../../modules/subscriptions/application/billing-route-boundary';
import { getStripePriceMapping } from '../../../../../modules/subscriptions/domain/plans';
import { loadOwnedSubscriptionAccount } from '../../../../../modules/subscriptions/infrastructure/owned-subscription-account';
import { createSubscriptionCheckoutIntentStore } from '../../../../../modules/subscriptions/infrastructure/subscription-checkout-intent-store';
import { StripeBillingProvider } from '../../../../../infrastructure/billing/stripe-provider';
import { FakeBillingProvider } from '../../../../../infrastructure/billing/fake-billing-provider';
import { task30FakeBillingProviderOrigin } from '../../../../../infrastructure/billing/task30-fake-provider-environment';

async function authenticateOrganization(
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: OrganizationId,
) {
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
}

export async function authenticateBillingRouteOrganization(organizationId: OrganizationId) {
  return authenticateOrganization(await createServerSupabaseClient(), organizationId);
}

async function createCommonDependencies() {
  const client = await createServerSupabaseClient();
  const environment = getBillingEnvironment();
  const publicOrigin = getPublicAppOrigin();
  const fakeProviderOrigin = task30FakeBillingProviderOrigin(process.env);
  const fakeProvider = fakeProviderOrigin !== null;
  const dependencies: BillingPortalRouteDependencies = {
    canonicalOrigin: fakeProviderOrigin ?? publicOrigin,
    ...(fakeProvider ? { providerReturnOrigin: publicOrigin } : {}),
    provider: fakeProvider
      ? new FakeBillingProvider()
      : new StripeBillingProvider({ secretKey: environment.STRIPE_SECRET_KEY }),
    authenticate: (organizationId) => authenticateOrganization(client, organizationId),
    loadOwnedAccount: (organizationId) => loadOwnedSubscriptionAccount(client, organizationId),
  };
  return { client, dependencies };
}

export async function createBillingPortalRouteDependencies(): Promise<BillingPortalRouteDependencies> {
  // Existing customer management needs no new-purchase prices or checkout-intent writer.
  return (await createCommonDependencies()).dependencies;
}

export async function createBillingRouteDependencies(): Promise<BillingRouteDependencies> {
  const { client, dependencies } = await createCommonDependencies();
  return {
    ...dependencies,
    prices: getStripePriceMapping(),
    checkoutIntents: createSubscriptionCheckoutIntentStore(client, createAdminSupabaseClient()),
  };
}
