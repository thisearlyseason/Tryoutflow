import { z } from 'zod';

import type { BillingProvider } from '../../../infrastructure/billing/billing-provider';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import {
  billingPageUrl,
  currentOwnerMatches,
  parseProviderSession,
  stableBillingIdempotencyKey,
  validateBillingOrigin,
  type BillingSessionError,
  type OwnedAccountLoader,
} from './billing-session-shared';
import type { SubscriptionAccount } from './subscription-account';

type PortalInput = Readonly<{
  organizationId: OrganizationId;
  organizationSlug: string;
  origin: string;
  clientAttemptId: unknown;
}>;

type PortalDependencies = Readonly<{
  provider: BillingProvider;
  loadOwnedAccount: OwnedAccountLoader;
}>;

export async function createPortalSession(
  input: PortalInput,
  actor: AuthorizationContext,
  dependencies: PortalDependencies,
): Promise<AppResult<Readonly<{ sessionId: string; url: string }>, BillingSessionError>> {
  const origin = validateBillingOrigin(input.origin);
  const attempt = z.uuid().safeParse(input.clientAttemptId);
  if (!attempt.success || attempt.data === '00000000-0000-0000-0000-000000000000')
    return failure({ code: 'invalid_attempt' });
  if (
    !origin ||
    !z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .safeParse(input.organizationSlug).success
  )
    return failure({ code: 'invalid_return_url' });
  if (!currentOwnerMatches(actor, input.organizationId)) return failure({ code: 'forbidden' });
  let account: SubscriptionAccount | null;
  try {
    account = await dependencies.loadOwnedAccount(input.organizationId, actor.userId);
  } catch {
    return failure({ code: 'billing_unavailable' });
  }
  if (!account || account.organizationId !== input.organizationId)
    return failure({ code: 'forbidden' });
  if (!account.providerCustomerId) return failure({ code: 'portal_unavailable' });
  try {
    const result = await dependencies.provider.createPortalSession(
      {
        organizationId: input.organizationId,
        customerId: account.providerCustomerId,
        returnUrl: billingPageUrl(origin, input.organizationSlug),
      },
      stableBillingIdempotencyKey([
        'portal',
        input.organizationId,
        origin,
        input.organizationSlug,
        account.version,
        attempt.data,
      ]),
    );
    const parsed = parseProviderSession(result, 'portal');
    return parsed.success ? success(parsed.data) : failure({ code: 'billing_unavailable' });
  } catch {
    return failure({ code: 'billing_unavailable' });
  }
}
