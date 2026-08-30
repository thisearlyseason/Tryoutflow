import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseOrganizationId, type OrganizationId } from '../../../../../../lib/ids';
import {
  billingCommandFailure,
  billingJsonError,
  billingRouteFailure,
  readBillingJson,
  type BillingRouteDependencies,
} from '../../../../../../modules/subscriptions/application/billing-route-boundary';
import { createPortalSession } from '../../../../../../modules/subscriptions/application/create-portal-session';

const bodySchema = z.object({ clientAttemptId: z.uuid() }).strict();

export async function handlePortalRequest(
  request: Request,
  organizationId: OrganizationId,
  dependencies: BillingRouteDependencies,
) {
  try {
    const body = bodySchema.safeParse(await readBillingJson(request, dependencies.canonicalOrigin));
    if (!body.success) return billingJsonError(400, 'invalid_request');
    const authenticated = await dependencies.authenticate(organizationId);
    if (!authenticated) return billingJsonError(403, 'forbidden');
    const result = await createPortalSession(
      {
        organizationId,
        organizationSlug: authenticated.organizationSlug,
        origin: dependencies.canonicalOrigin,
        clientAttemptId: body.data.clientAttemptId,
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
    return handlePortalRequest(request, organizationId, await createBillingRouteDependencies());
  } catch {
    return billingJsonError(503, 'billing_unavailable');
  }
}
