import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { OrganizationId } from '../../../../../../lib/ids';
import {
  billingCommandFailure,
  billingJsonError,
  billingRouteFailure,
  readBillingJson,
  type BillingRouteDependencies,
} from '../../../../../../modules/subscriptions/application/billing-route-boundary';
import { createCheckoutSession } from '../../../../../../modules/subscriptions/application/create-checkout-session';

const bodySchema = z
  .object({ plan: z.enum(['team', 'club', 'association']), clientAttemptId: z.uuid() })
  .strict();

export async function handleCheckoutRequest(
  request: Request,
  organizationId: OrganizationId,
  dependencies: BillingRouteDependencies,
) {
  try {
    const body = bodySchema.safeParse(await readBillingJson(request, dependencies.canonicalOrigin));
    if (!body.success) return billingJsonError(400, 'invalid_request');
    const authenticated = await dependencies.authenticate(organizationId);
    if (!authenticated) return billingJsonError(403, 'forbidden');
    const result = await createCheckoutSession(
      {
        organizationId,
        organizationSlug: authenticated.organizationSlug,
        plan: body.data.plan,
        clientAttemptId: body.data.clientAttemptId,
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
