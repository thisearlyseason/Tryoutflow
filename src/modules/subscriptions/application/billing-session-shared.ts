import { createHash } from 'node:crypto';

import { z } from 'zod';

import { billingProviderIdSchema } from '../../../infrastructure/billing/billing-provider';
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

function isExpectedProviderUrl(value: string, kind: 'checkout' | 'portal'): boolean {
  const url = new URL(value);
  const expected =
    kind === 'checkout'
      ? { hostname: 'checkout.stripe.com', path: '/c/pay/' }
      : { hostname: 'billing.stripe.com', path: '/p/session/' };
  return (
    url.protocol === 'https:' &&
    url.hostname === expected.hostname &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname.startsWith(expected.path)
  );
}

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
      ? z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9_]{8,200}$/u)
      : z.string().regex(/^bps_[A-Za-z0-9_]{8,200}$/u);
  return z
    .object({
      sessionId: sessionId.pipe(billingProviderIdSchema),
      url: z.url().refine((value) => isExpectedProviderUrl(value, kind)),
    })
    .strict()
    .safeParse(input);
}
