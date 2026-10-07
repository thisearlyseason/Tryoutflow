import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { OrganizationId } from '../../../../../../lib/ids';
import {
  billingCommandFailure,
  billingJsonError,
  billingRouteFailure,
  readBillingJson,
  type BillingRouteDependencies,
  type LazyBillingRouteDependencies,
} from '../../../../../../modules/subscriptions/application/billing-route-boundary';
import { createCheckoutSession } from '../../../../../../modules/subscriptions/application/create-checkout-session';

const bodySchema = z
  .object({
    plan: z.enum(['team', 'club', 'association']),
    clientAttemptId: z.uuid(),
    checkoutProtocol: z.enum(['standard_tax_v1', 'managed_v1']).optional(),
    billingCountry: z.unknown().optional(),
  })
  .strict();

export async function handleCheckoutRequest(
  request: Request,
  organizationId: OrganizationId,
  dependencySource:
    BillingRouteDependencies | LazyBillingRouteDependencies<BillingRouteDependencies>,
) {
  try {
    const body = bodySchema.safeParse(
      await readBillingJson(request, dependencySource.canonicalOrigin),
    );
    if (!body.success) return billingJsonError(400, 'invalid_request');
    // Rejection and owner authorization must not depend on provider credential readiness.
    const authenticated = await dependencySource.authenticate(organizationId);
    if (!authenticated) return billingJsonError(403, 'forbidden');
    const dependencies =
      'loadDependencies' in dependencySource
        ? await dependencySource.loadDependencies()
        : dependencySource;
    const result = await createCheckoutSession(
      {
        organizationId,
        organizationSlug: authenticated.organizationSlug,
        plan: body.data.plan,
        clientAttemptId: body.data.clientAttemptId,
        checkoutProtocol: body.data.checkoutProtocol,
        billingCountry: body.data.billingCountry,
        origin: dependencies.providerReturnOrigin ?? dependencies.canonicalOrigin,
      },
      authenticated.actor,
      dependencies,
    );
    return result.ok
      ? NextResponse.json({ sessionId: result.value.sessionId, url: result.value.url })
      : billingCommandFailure(result.error.code);
  } catch (error) {
    return billingRouteFailure(error);
  }
}
