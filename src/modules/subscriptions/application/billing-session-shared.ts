import { createHash } from 'node:crypto';

import { z } from 'zod';

import { billingProviderIdSchema } from '../../../infrastructure/billing/billing-provider';
import { isValidBillingSessionUrl } from '../../../infrastructure/billing/provider-session-url';
import type { OrganizationId, UserId } from '../../../lib/ids';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import type { SubscriptionAccount } from './subscription-account';

export type OwnedAccountLoader = (
  organizationId: OrganizationId,
  userId: UserId,
) => Promise<SubscriptionAccount | null>;

export type BillingSessionError = Readonly<{
  code:
    | 'forbidden'
    | 'invalid_plan'
    | 'invalid_return_url'
    | 'subscription_exists'
    | 'checkout_in_progress'
    | 'invalid_attempt'
    | 'portal_unavailable'
    | 'billing_unavailable';
}>;

export function validateBillingOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.origin !== raw || url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function currentOwnerMatches(
  actor: AuthorizationContext,
  organizationId: OrganizationId,
): boolean {
  return (
    actor.organizationId === organizationId &&
    actor.organizationRole === 'owner' &&
    actor.membershipStatus === 'active'
  );
}

export function stableBillingIdempotencyKey(parts: readonly (string | number)[]): string {
  return `tryoutflow:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

export function billingPageUrl(origin: string, organizationSlug: string, query?: string): string {
  const url = new URL(
    `/app/${encodeURIComponent(organizationSlug)}/organization/billing`,
    `${origin}/`,
  );
  if (query) url.search = query;
  return url.href;
}

export function parseProviderSession(input: unknown, kind: 'checkout' | 'portal') {
  const sessionId =
    kind === 'checkout'
      ? z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9]{8,200}$/u)
      : z.string().regex(/^bps_[A-Za-z0-9]{8,200}$/u);
  return z
    .object({
      sessionId: sessionId.pipe(billingProviderIdSchema),
      url: z.string().min(1).max(4_096),
    })
    .strict()
    .refine((value) => isValidBillingSessionUrl(value.sessionId, value.url, kind))
    .safeParse(input);
}
