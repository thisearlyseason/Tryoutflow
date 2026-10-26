import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveEffectiveEntitlements,
  hasEntitlement,
  subscriptionAccessEnd,
  type EntitlementGrant,
} from '@/modules/subscriptions/domain/effective-entitlements';
import { normalizeSubscriptionStatus } from '@/modules/subscriptions/domain/provider-status';
import {
  verifyRevenueCatWebhook,
  verifiedNativeSubscription,
} from '@/modules/subscriptions/providers/revenuecat';
import { billingConfiguration } from '@/modules/subscriptions/providers/configuration';
const org = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  tryout = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-10-15T00:00:00Z');
const grant: EntitlementGrant = {
  organizationId: org,
  tryoutId: null,
  tier: 'pro',
  source: 'organization_subscription',
  features: ['radar_charts', 'player_comparison'],
  startsAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-11-01T00:00:00Z',
};
const access = (grants: EntitlementGrant[], scope?: string) =>
  resolveEffectiveEntitlements({ organizationId: org, tryoutId: scope, grants, now });
afterEach(() => vi.unstubAllEnvs());
describe('entitlement lifecycle', () => {
  it('Free keeps basic scoring but cannot use paid operations', () => {
    expect(hasEntitlement(access([]), 'basic_evaluations')).toBe(true);
    expect(hasEntitlement(access([]), 'radar_charts')).toBe(false);
  });
  it('Pro grants paid features across the organization', () =>
    expect(hasEntitlement(access([grant], tryout), 'player_comparison')).toBe(true));
  it.each(['2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', 'invalid'])(
    'does not grant expired or invalid access: %s',
    (expiresAt) =>
      expect(hasEntitlement(access([{ ...grant, expiresAt }]), 'radar_charts')).toBe(false),
  );
  it('rejects future and revoked grants', () => {
    expect(access([{ ...grant, startsAt: '2026-12-01T00:00:00Z' }]).plan).toBe('free');
    expect(access([{ ...grant, revokedAt: now.toISOString() }]).plan).toBe('free');
  });
  it('does not cross organizations or tryout scopes', () => {
    expect(access([{ ...grant, organizationId: other }]).plan).toBe('free');
    expect(access([{ ...grant, tryoutId: tryout }]).plan).toBe('free');
    expect(access([{ ...grant, tryoutId: tryout }], tryout).plan).toBe('pro');
  });
  it('manual grants supplement rather than downgrade paid access', () => {
    const result = access([
      { ...grant, tier: 'organization', features: ['custom_branding'] },
      { ...grant, source: 'manual' },
    ]);
    expect(result.plan).toBe('organization');
    expect(hasEntitlement(result, 'player_comparison')).toBe(true);
    expect(hasEntitlement(result, 'branding')).toBe(true);
  });
  it('expired complimentary access ends without deleting history', () => {
    const grants = [{ ...grant, source: 'manual' as const, expiresAt: '2026-10-01T00:00:00Z' }];
    expect(access(grants).plan).toBe('free');
    expect(grants).toHaveLength(1);
  });
  it('unknown and inherited object keys fail closed', () => {
    expect(hasEntitlement(access([grant]), 'toString')).toBe(false);
    expect(hasEntitlement(access([grant]), '__proto__')).toBe(false);
  });
  it('cancellation retains paid access until the period ends', () =>
    expect(
      subscriptionAccessEnd({ state: 'cancelled', currentPeriodEnd: grant.expiresAt, now }),
    ).toBe(grant.expiresAt));
  it('honors verified grace without inventing another grace period', () => {
    expect(
      subscriptionAccessEnd({
        state: 'grace_period',
        currentPeriodEnd: '2026-10-14T00:00:00Z',
        gracePeriodEnd: grant.expiresAt,
        now,
      }),
    ).toBe(grant.expiresAt);
    expect(
      subscriptionAccessEnd({ state: 'past_due', currentPeriodEnd: '2026-10-14T00:00:00Z', now }),
    ).toBeNull();
  });
  it.each(['expired', 'refunded', 'paused', 'incomplete'] as const)(
    '%s cannot grant access',
    (state) =>
      expect(subscriptionAccessEnd({ state, currentPeriodEnd: grant.expiresAt, now })).toBeNull(),
  );
  it('normalizes provider states and fails closed for unknown states', () => {
    expect(normalizeSubscriptionStatus('stripe', 'canceled')).toBe('expired');
    expect(normalizeSubscriptionStatus('stripe', 'unpaid')).toBe('expired');
    expect(normalizeSubscriptionStatus('revenuecat', 'billing_issue')).toBe('past_due');
    expect(normalizeSubscriptionStatus('stripe', 'future_state')).toBe('incomplete');
  });
});
describe('RevenueCat authenticity', () => {
  const body = Buffer.from('{"event":{"type":"TEST"}}');
  const secret = 'a'.repeat(40),
    signing = 'b'.repeat(40);
  const timestamp = Math.floor(now.getTime() / 1000);
  const signed = (t = timestamp, data = body) =>
    `t=${t},v1=${createHmac('sha256', signing).update(`${t}.`).update(data).digest('hex')}`;
  const headers = (signature = signed()) =>
    new Headers({ Authorization: `Bearer ${secret}`, 'X-RevenueCat-Webhook-Signature': signature });
  const env = { REVENUECAT_WEBHOOK_SECRET: secret, REVENUECAT_WEBHOOK_SIGNING_SECRET: signing };
  it('accepts exact bytes with valid auth and signature', () =>
    expect(verifyRevenueCatWebhook(body, headers(), env, now.getTime())).toBe(true));
  it('rejects altered bytes and invalid authorization', () => {
    expect(verifyRevenueCatWebhook(Buffer.from('{}'), headers(), env, now.getTime())).toBe(false);
    expect(verifyRevenueCatWebhook(body, new Headers(), env, now.getTime())).toBe(false);
  });
  it.each([-301, 31])('rejects timestamp skew %s seconds', (offset) =>
    expect(
      verifyRevenueCatWebhook(body, headers(signed(timestamp + offset)), env, now.getTime()),
    ).toBe(false),
  );
  it('rejects duplicate timestamp fields and missing required signature', () => {
    expect(
      verifyRevenueCatWebhook(body, headers(`${signed()},t=${timestamp}`), env, now.getTime()),
    ).toBe(false);
    expect(verifyRevenueCatWebhook(body, headers(''), env, now.getTime())).toBe(false);
  });
  it('supports documented authorization-only configuration', () =>
    expect(
      verifyRevenueCatWebhook(
        body,
        new Headers({ Authorization: `Bearer ${secret}` }),
        { REVENUECAT_WEBHOOK_SECRET: secret },
        now.getTime(),
      ),
    ).toBe(true));
});
describe('native provider reconciliation', () => {
  const record = {
    store: 'app_store',
    is_sandbox: true,
    expires_date: grant.expiresAt,
    original_purchase_date: grant.startsAt,
    purchase_date: grant.startsAt,
    ownership_type: 'PURCHASED',
    period_type: 'normal',
  };
  const parse = (overrides: Record<string, unknown> = {}, owner = org) =>
    verifiedNativeSubscription({
      customer: {
        original_app_user_id: owner,
        subscriptions: { product: { ...record, ...overrides } },
        non_subscriptions: {},
      },
      userId: org,
      provider: 'apple',
      productId: 'product',
      productKey: 'pro_monthly',
      contractId: 'original-transaction',
      observedAt: now.toISOString(),
    });
  it('retains active access after cancellation', () => {
    vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
    const result = parse({ unsubscribe_detected_at: now.toISOString() });
    expect(result.status).toBe('active');
    expect(result.cancel_at_period_end).toBe(true);
  });
  it('maps refund, failure, grace, recovery and expiration', () => {
    vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
    expect(parse({ refunded_at: now.toISOString() }).status).toBe('refunded');
    expect(parse({ billing_issues_detected_at: now.toISOString() }).status).toBe('past_due');
    expect(
      parse({
        billing_issues_detected_at: now.toISOString(),
        grace_period_expires_date: grant.expiresAt,
      }).status,
    ).toBe('grace_period');
    expect(parse().status).toBe('active');
    expect(parse({ expires_date: '2026-10-14T00:00:00Z' }).status).toBe('expired');
  });
  it('rejects cross-account restore and shared receipts', () => {
    vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
    expect(() => parse({}, other)).toThrow('purchase_account_conflict');
    expect(() => parse({ ownership_type: 'FAMILY_SHARED' })).toThrow();
  });
  it('rejects sandbox receipts in production', () => {
    vi.stubEnv('BILLING_ENVIRONMENT', 'production');
    expect(() => parse()).toThrow();
  });
  it('rejects ambiguous product mappings', () =>
    expect(() =>
      billingConfiguration({
        BILLING_ENVIRONMENT: 'sandbox',
        STRIPE_PRICE_PRO_MONTHLY: 'same',
        STRIPE_PRICE_PRO_ANNUAL: 'same',
      }),
    ).toThrow('ambiguous_product_configuration'));
});
