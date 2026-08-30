// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { FakeBillingProvider } from '../../../src/infrastructure/billing/fake-billing-provider';
import { parseOrganizationId, parseUserId } from '../../../src/lib/ids';
import { createCheckoutSession } from '../../../src/modules/subscriptions/application/create-checkout-session';
import { createPortalSession } from '../../../src/modules/subscriptions/application/create-portal-session';
import type { SubscriptionAccount } from '../../../src/modules/subscriptions/application/subscription-account';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { handleCheckoutRequest } from '../../../src/app/api/organizations/[organizationId]/billing/checkout/route';
import { handlePortalRequest } from '../../../src/app/api/organizations/[organizationId]/billing/portal/route';

const organizationId = parseOrganizationId('11111111-1111-4111-8111-111111111111');
const otherOrganizationId = parseOrganizationId('22222222-2222-4222-8222-222222222222');
const ownerId = parseUserId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const secondOwnerId = parseUserId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const prices = {
  team: 'price_Task25Team01',
  club: 'price_Task25Club01',
  association: 'price_Task25Association01',
} as const;
const organizationSlug = 'badlands-hockey-academy';
const owner: AuthorizationContext = {
  userId: ownerId,
  organizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};
const administrator: AuthorizationContext = { ...owner, organizationRole: 'administrator' };
const secondOwner: AuthorizationContext = { ...owner, userId: secondOwnerId };
const trialAccount: SubscriptionAccount = {
  organizationId,
  providerCustomerId: null,
  providerSubscriptionId: null,
  providerPriceId: null,
  plan: 'trial',
  state: 'trialing',
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: null,
  cancelAt: null,
  canceledAt: null,
  trialEnd: null,
  verifiedAt: '2026-08-29T00:00:00.000Z',
  version: 0,
};

function dependencies(account: SubscriptionAccount | null, provider = new FakeBillingProvider()) {
  return {
    provider,
    prices,
    loadOwnedAccount: async () => account,
  };
}

describe('owner billing sessions', () => {
  it('requires the current active owner record at execution time', async () => {
    const adminResult = await createCheckoutSession(
      { organizationId, organizationSlug, plan: 'team', origin: 'https://app.tryoutflow.test' },
      administrator,
      dependencies(trialAccount),
    );
    const staleOwnerResult = await createPortalSession(
      { organizationId, organizationSlug, origin: 'https://app.tryoutflow.test' },
      owner,
      dependencies(null),
    );
    expect(adminResult).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(staleOwnerResult).toEqual({ ok: false, error: { code: 'forbidden' } });
  });

  it('returns a typed unavailable result when current owner reauthorization cannot be read', async () => {
    const unavailable = {
      provider: new FakeBillingProvider(),
      prices,
      loadOwnedAccount: async () => {
        throw new Error('database secret that must not escape');
      },
    };
    await expect(
      createCheckoutSession(
        {
          organizationId,
          organizationSlug,
          plan: 'team',
          origin: 'https://app.tryoutflow.test',
        },
        owner,
        unavailable,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'billing_unavailable' } });
    await expect(
      createPortalSession(
        {
          organizationId,
          organizationSlug,
          origin: 'https://app.tryoutflow.test',
        },
        owner,
        unavailable,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'billing_unavailable' } });
  });

  it('fails closed for route and command tenant mismatches without provider calls', async () => {
    const provider = new FakeBillingProvider();
    const result = await createCheckoutSession(
      {
        organizationId: otherOrganizationId,
        organizationSlug,
        plan: 'team',
        origin: 'https://app.tryoutflow.test',
      },
      owner,
      dependencies({ ...trialAccount, organizationId: otherOrganizationId }, provider),
    );
    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(provider.submissions.size).toBe(0);
  });

  it('uses centralized server prices, canonical URLs, metadata, and a stable replay key', async () => {
    const provider = new FakeBillingProvider();
    const input = {
      organizationId,
      organizationSlug,
      plan: 'club' as const,
      origin: 'https://app.tryoutflow.test',
    };
    const first = await createCheckoutSession(input, owner, dependencies(trialAccount, provider));
    const repeated = await createCheckoutSession(
      input,
      owner,
      dependencies(trialAccount, provider),
    );
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      ok: true,
      value: { url: expect.stringMatching(/^https:/) },
    });
    if (first.ok) expect(first.value).not.toHaveProperty('replayed');
    expect(provider.submissions.size).toBe(1);
    const submission = [...provider.submissions.values()][0];
    expect(submission?.input).toEqual({
      organizationId,
      plan: 'club',
      priceId: prices.club,
      successUrl:
        'https://app.tryoutflow.test/app/badlands-hockey-academy/organization/billing?checkout=complete',
      cancelUrl:
        'https://app.tryoutflow.test/app/badlands-hockey-academy/organization/billing?checkout=cancelled',
    });
  });

  it('deduplicates concurrent checkout and portal sessions across active co-owners', async () => {
    const provider = new FakeBillingProvider();
    const checkoutInput = {
      organizationId,
      organizationSlug,
      plan: 'team' as const,
      origin: 'https://app.tryoutflow.test',
    };
    const checkoutDependencies = dependencies(trialAccount, provider);
    const [firstCheckout, secondCheckout] = await Promise.all([
      createCheckoutSession(checkoutInput, owner, checkoutDependencies),
      createCheckoutSession(checkoutInput, secondOwner, checkoutDependencies),
    ]);
    expect(secondCheckout).toEqual(firstCheckout);
    expect(provider.submissions.size).toBe(1);

    const paidAccount = {
      ...trialAccount,
      providerCustomerId: 'cus_Task25Customer01',
      providerSubscriptionId: 'sub_Task25Subscript01',
      providerPriceId: prices.team,
      plan: 'team' as const,
      state: 'active' as const,
      version: 3,
    };
    const portalInput = {
      organizationId,
      organizationSlug,
      origin: 'https://app.tryoutflow.test',
    };
    const portalDependencies = dependencies(paidAccount, provider);
    const [firstPortal, secondPortal] = await Promise.all([
      createPortalSession(portalInput, owner, portalDependencies),
      createPortalSession(portalInput, secondOwner, portalDependencies),
    ]);
    expect(secondPortal).toEqual(firstPortal);
    expect(provider.submissions.size).toBe(2);
  });

  it('does not reuse a provider key when the canonical deployment origin changes', async () => {
    const provider = new FakeBillingProvider();
    const shared = { organizationId, organizationSlug, plan: 'team' as const };
    const first = await createCheckoutSession(
      { ...shared, origin: 'https://app.tryoutflow.test' },
      owner,
      dependencies(trialAccount, provider),
    );
    const moved = await createCheckoutSession(
      { ...shared, origin: 'https://new.tryoutflow.test' },
      owner,
      dependencies(trialAccount, provider),
    );
    expect(first.ok).toBe(true);
    expect(moved.ok).toBe(true);
    expect(provider.submissions.size).toBe(2);
  });

  it('rejects unknown plans, unsafe origins, and existing live provider subscriptions', async () => {
    const provider = new FakeBillingProvider();
    const invalidPlan = await createCheckoutSession(
      {
        organizationId,
        organizationSlug,
        plan: 'enterprise',
        origin: 'https://app.tryoutflow.test',
      },
      owner,
      dependencies(trialAccount, provider),
    );
    const unsafeOrigin = await createCheckoutSession(
      {
        organizationId,
        organizationSlug,
        plan: 'team',
        origin: 'https://app.tryoutflow.test/redirect',
      },
      owner,
      dependencies(trialAccount, provider),
    );
    const insecureLocalOrigin = await createCheckoutSession(
      {
        organizationId,
        organizationSlug,
        plan: 'team',
        origin: 'http://localhost:3000',
      },
      owner,
      dependencies(trialAccount, provider),
    );
    const active = await createCheckoutSession(
      { organizationId, organizationSlug, plan: 'team', origin: 'https://app.tryoutflow.test' },
      owner,
      dependencies(
        {
          ...trialAccount,
          plan: 'team',
          state: 'active',
          providerCustomerId: 'cus_Task25Customer01',
          providerSubscriptionId: 'sub_Task25Subscript01',
        },
        provider,
      ),
    );
    expect(invalidPlan).toEqual({ ok: false, error: { code: 'invalid_plan' } });
    expect(unsafeOrigin).toEqual({ ok: false, error: { code: 'invalid_return_url' } });
    expect(insecureLocalOrigin).toEqual({
      ok: false,
      error: { code: 'invalid_return_url' },
    });
    expect(active).toEqual({ ok: false, error: { code: 'subscription_exists' } });
    expect(provider.submissions.size).toBe(0);
  });

  it('creates a portal only for a verified customer and reuses its stable session', async () => {
    const provider = new FakeBillingProvider();
    const account = {
      ...trialAccount,
      providerCustomerId: 'cus_Task25Customer01',
      providerSubscriptionId: 'sub_Task25Subscript01',
      providerPriceId: prices.team,
      plan: 'team' as const,
      state: 'past_due' as const,
      version: 9,
    };
    const input = { organizationId, organizationSlug, origin: 'https://app.tryoutflow.test' };
    const first = await createPortalSession(input, owner, dependencies(account, provider));
    const repeated = await createPortalSession(input, owner, dependencies(account, provider));
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ ok: true, value: { url: expect.stringMatching(/^https:/) } });
    expect([...provider.submissions.values()][0]?.input).toEqual({
      organizationId,
      customerId: 'cus_Task25Customer01',
      returnUrl: 'https://app.tryoutflow.test/app/badlands-hockey-academy/organization/billing',
    });
    expect(await createPortalSession(input, owner, dependencies(trialAccount, provider))).toEqual({
      ok: false,
      error: { code: 'portal_unavailable' },
    });
  });
});

describe('billing session HTTP boundary', () => {
  const canonicalOrigin = 'https://app.tryoutflow.test';
  const checkoutRequest = (body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${canonicalOrigin}/api/organizations/${organizationId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: canonicalOrigin,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const routeDependencies = (account: SubscriptionAccount | null) => ({
    canonicalOrigin,
    provider: new FakeBillingProvider(),
    prices,
    authenticate: async () => ({ actor: owner, organizationSlug }),
    loadOwnedAccount: async () => account,
  });

  it('accepts only bounded same-origin JSON with no body organization scope', async () => {
    const dependencies = routeDependencies(trialAccount);
    expect(
      (await handleCheckoutRequest(checkoutRequest({ plan: 'team' }), organizationId, dependencies))
        .status,
    ).toBe(200);
    expect(
      (
        await handleCheckoutRequest(
          checkoutRequest({ plan: 'team', organizationId: otherOrganizationId }),
          organizationId,
          dependencies,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleCheckoutRequest(
          checkoutRequest({ plan: 'team' }, { origin: 'https://evil.example' }),
          organizationId,
          dependencies,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleCheckoutRequest(
          checkoutRequest({ plan: 'team' }, { 'content-type': 'text/plain' }),
          organizationId,
          dependencies,
        )
      ).status,
    ).toBe(415);
  });

  it('does not expose whether another tenant has billing state', async () => {
    const denied = {
      ...routeDependencies(trialAccount),
      authenticate: async () => null,
    };
    const missing = { ...denied, loadOwnedAccount: async () => null };
    const foreign = await handleCheckoutRequest(
      checkoutRequest({ plan: 'team' }),
      otherOrganizationId,
      denied,
    );
    const absent = await handleCheckoutRequest(
      checkoutRequest({ plan: 'team' }),
      otherOrganizationId,
      missing,
    );
    expect([foreign.status, await foreign.json()]).toEqual([403, { error: 'forbidden' }]);
    expect([absent.status, await absent.json()]).toEqual([403, { error: 'forbidden' }]);
  });

  it('portal accepts an empty body and a checkout return query cannot mutate entitlements', async () => {
    const account = {
      ...trialAccount,
      providerCustomerId: 'cus_Task25Customer01',
      providerSubscriptionId: 'sub_Task25Subscript01',
      providerPriceId: prices.team,
      plan: 'team' as const,
      state: 'active' as const,
      version: 7,
    };
    let loads = 0;
    const dependencies = {
      ...routeDependencies(account),
      loadOwnedAccount: async () => {
        loads += 1;
        return account;
      },
    };
    const request = new Request(
      `${canonicalOrigin}/api/organizations/${organizationId}/billing/portal?checkout=complete&plan=association`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: canonicalOrigin },
        body: '{}',
      },
    );
    const response = await handlePortalRequest(request, organizationId, dependencies);
    expect(response.status).toBe(200);
    expect(loads).toBe(1);
    expect(account.plan).toBe('team');
    expect(account.state).toBe('active');
  });
});
