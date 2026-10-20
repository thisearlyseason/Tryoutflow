import { parseOrganizationId, type OrganizationId } from '../../../../../../lib/ids';
import { billingJsonError } from '../../../../../../modules/subscriptions/application/billing-route-boundary';
import { getPublicAppOrigin } from '../../../../../../lib/env';
import { task30FakeBillingProviderOrigin } from '../../../../../../infrastructure/billing/task30-fake-provider-environment';
import { handleCheckoutRequest } from './checkout-request';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  let organizationId: OrganizationId;
  try {
    organizationId = parseOrganizationId((await params).organizationId);
  } catch {
    return billingJsonError(400, 'invalid_request');
  }
  try {
    return handleCheckoutRequest(request, organizationId, {
      canonicalOrigin: task30FakeBillingProviderOrigin(process.env) ?? getPublicAppOrigin(),
      async authenticate(organizationId) {
        const { authenticateBillingRouteOrganization } =
          await import('../billing-route-dependencies');
        return authenticateBillingRouteOrganization(organizationId);
      },
      async loadDependencies() {
        const { createBillingRouteDependencies } = await import('../billing-route-dependencies');
        return createBillingRouteDependencies();
      },
    });
  } catch {
    return billingJsonError(503, 'billing_unavailable');
  }
}
