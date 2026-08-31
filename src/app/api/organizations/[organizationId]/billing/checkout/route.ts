import { parseOrganizationId, type OrganizationId } from '../../../../../../lib/ids';
import { billingJsonError } from '../../../../../../modules/subscriptions/application/billing-route-boundary';
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
    const { createBillingRouteDependencies } = await import('../billing-route-dependencies');
    return handleCheckoutRequest(request, organizationId, await createBillingRouteDependencies());
  } catch {
    return billingJsonError(503, 'billing_unavailable');
  }
}
