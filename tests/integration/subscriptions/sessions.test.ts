// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { FakeBillingProvider } from '../../../src/infrastructure/billing/fake-billing-provider';
import type { BillingProvider } from '../../../src/infrastructure/billing/billing-provider';
import { parseOrganizationId, parseUserId } from '../../../src/lib/ids';
import { createCheckoutSession } from '../../../src/modules/subscriptions/application/create-checkout-session';
import { createPortalSession } from '../../../src/modules/subscriptions/application/create-portal-session';
import {
  subscriptionAccountRowSchema,
  type SubscriptionAccount,
} from '../../../src/modules/subscriptions/application/subscription-account';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { CheckoutIntentStore } from '../../../src/modules/subscriptions/application/checkout-intent';
import { handleCheckoutRequest } from '../../../src/app/api/organizations/[organizationId]/billing/checkout/checkout-request';
import { handlePortalRequest } from '../../../src/app/api/organizations/[organizationId]/billing/portal/portal-request';

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
const checkoutAttemptId = '11111111-1111-4111-8111-111111111101';
const portalAttemptId = '11111111-1111-4111-8111-111111111102';
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

const stores = new WeakMap<BillingProvider, CheckoutIntentStore>();
function storeFor(provider: BillingProvider): CheckoutIntentStore {
  const prior = stores.get(provider);
  if (prior) return prior;
  const intents = new Map<
    string,
    {
      plan: string;
      initiatingOwnerUserId: string;
      state: 'pending' | 'completed' | 'failed';
      key: string;
      sessionId?: string;
      url?: string;
    }
  >();
  const store: CheckoutIntentStore = {
    async reserve(input) {
      const exact = intents.get(input.clientAttemptId);
      if (exact)
        return {
          outcome:
            exact.plan !== input.plan || exact.initiatingOwnerUserId !== input.initiatingOwnerUserId
              ? 'forbidden'
              : exact.state,
          idempotencyKey: exact.key,
          sessionId: exact.sessionId ?? null,
          resultUrl: exact.url ?? null,
        };
      const active = [...intents.values()].find(
        (intent) => intent.state === 'pending' || intent.state === 'completed',
      );
      if (active)
        return {
          outcome: 'in_progress',
          idempotencyKey: active.key,
          sessionId: null,
          resultUrl: null,
        };
      const key = `tryoutflow:${input.clientAttemptId.replaceAll('-', '').padEnd(64, '0')}`;
      intents.set(input.clientAttemptId, {
        plan: input.plan,
        initiatingOwnerUserId: input.initiatingOwnerUserId,
        state: 'pending',
        key,
      });
      return { outcome: 'reserved', idempotencyKey: key, sessionId: null, resultUrl: null };
    },
    async complete(input) {
      const intent = intents.get(input.clientAttemptId);
      if (!intent || intent.state === 'failed') return 'not_found';
      intent.state = 'completed';
      intent.sessionId = input.sessionId;
      intent.url = input.resultUrl;
      return 'completed';
    },
    async fail(input) {
      const intent = intents.get(input.clientAttemptId);
      if (!intent) return 'not_found';
      intent.state = 'failed';
      return 'failed';
    },
  };
  stores.set(provider, store);
  return store;
}

function dependencies(
  account: SubscriptionAccount | null,
  provider: BillingProvider = new FakeBillingProvider(),
) {
  return {
    provider,
    prices,
    loadOwnedAccount: async () => account,
    checkoutIntents: storeFor(provider),
  };
}

describe('owner billing sessions', () => {
  it('accepts PostgREST UTC-offset timestamptz values', () => {
    expect(
      subscriptionAccountRowSchema.parse({
        organization_id: organizationId,
        provider_customer_id: null,
        provider_subscription_id: null,
        provider_price_id: null,
        plan_key: null,
        state: 'trialing',
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: null,
        cancel_at: null,
        canceled_at: null,
        trial_end: '2026-09-14T12:00:00+00:00',
        verified_at: '2026-08-31T12:00:00+00:00',
        version: 1,
      }).state,
    ).toBe('trialing');
  });
  it('requires the current active owner record at execution time', async () => {
    const adminResult = await createCheckoutSession(
      {
        organizationId,
        organizationSlug,
        plan: 'team',
        origin: 'https://app.tryoutflow.test',
        clientAttemptId: checkoutAttemptId,
      },
      administrator,
      dependencies(trialAccount),
    );
    const staleOwnerResult = await createPortalSession(
      {
        organizationId,
        organizationSlug,
        origin: 'https://app.tryoutflow.test',
        clientAttemptId: portalAttemptId,
      },
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
      checkoutIntents: storeFor(new FakeBillingProvider()),
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
          clientAttemptId: checkoutAttemptId,
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
          clientAttemptId: portalAttemptId,
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
        clientAttemptId: checkoutAttemptId,
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
      clientAttemptId: checkoutAttemptId,
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

  it('binds checkout replay to the initiating owner while portal clicks remain independent', async () => {
    const provider = new FakeBillingProvider();
    const checkoutInput = {
      organizationId,
      organizationSlug,
      plan: 'team' as const,
      origin: 'https://app.tryoutflow.test',
      clientAttemptId: checkoutAttemptId,
    };
    const checkoutDependencies = dependencies(trialAccount, provider);
    const [firstCheckout, secondCheckout] = await Promise.all([
      createCheckoutSession(checkoutInput, owner, checkoutDependencies),
      createCheckoutSession(checkoutInput, secondOwner, checkoutDependencies),
    ]);
    expect(firstCheckout.ok).toBe(true);
    expect(secondCheckout).toEqual({ ok: false, error: { code: 'forbidden' } });
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
      clientAttemptId: portalAttemptId,
    };
    const portalDependencies = dependencies(paidAccount, provider);
    const [firstPortal, secondPortal] = await Promise.all([
      createPortalSession(portalInput, owner, portalDependencies),
      createPortalSession(portalInput, secondOwner, portalDependencies),
    ]);
    expect(secondPortal).toEqual(firstPortal);
    expect(provider.submissions.size).toBe(2);
  });

  it('keeps completed checkout as the organization fence until verified activation', async () => {
    const provider = new FakeBillingProvider();
    const sharedDependencies = dependencies(trialAccount, provider);
    const [team, club] = await Promise.all([
      createCheckoutSession(
        {
          organizationId,
          organizationSlug,
          plan: 'team',
          origin: 'https://app.tryoutflow.test',
          clientAttemptId: '11111111-1111-4111-8111-111111111120',
        },
        owner,
        sharedDependencies,
      ),
      createCheckoutSession(
        {
          organizationId,
          organizationSlug,
          plan: 'club',
          origin: 'https://app.tryoutflow.test',
          clientAttemptId: '11111111-1111-4111-8111-111111111121',
        },
        secondOwner,
        sharedDependencies,
      ),
    ]);
    expect([team, club].filter((result) => result.ok)).toHaveLength(1);
    expect([team, club].filter((result) => !result.ok)).toEqual([
      { ok: false, error: { code: 'checkout_in_progress' } },
    ]);
    expect(provider.submissions.size).toBe(1);

    const blockedAfterCompletion = await createCheckoutSession(
      {
        organizationId,
        organizationSlug,
        plan: 'association',
        origin: 'https://app.tryoutflow.test',
        clientAttemptId: '11111111-1111-4111-8111-111111111122',
      },
      owner,
      sharedDependencies,
    );
    expect(blockedAfterCompletion).toEqual({
      ok: false,
      error: { code: 'checkout_in_progress' },
    });
    expect(provider.submissions.size).toBe(1);
  });

  it('releases permanent provider failures but keeps temporary and unsafe delivery uncertain', async () => {
    const rejected = new FakeBillingProvider('rejected');
    const rejectedDependencies = dependencies(trialAccount, rejected);
    const rejectedInput = {
      organizationId,
      organizationSlug,
      plan: 'team' as const,
      origin: 'https://app.tryoutflow.test',
      clientAttemptId: '11111111-1111-4111-8111-111111111140',
    };
    expect(await createCheckoutSession(rejectedInput, owner, rejectedDependencies)).toEqual({
      ok: false,
      error: { code: 'billing_unavailable' },
    });
    const afterPermanent = await rejectedDependencies.checkoutIntents.reserve({
      organizationId,
      initiatingOwnerUserId: ownerId,
      plan: 'club',
      clientAttemptId: '11111111-1111-4111-8111-111111111141',
    });
    expect(afterPermanent.outcome).toBe('reserved');

    const temporary = new FakeBillingProvider('temporary');
    const temporaryDependencies = dependencies(trialAccount, temporary);
    await createCheckoutSession(
      { ...rejectedInput, clientAttemptId: '11111111-1111-4111-8111-111111111142' },
      owner,
      temporaryDependencies,
    );
    const blockedAfterTemporary = await temporaryDependencies.checkoutIntents.reserve({
      organizationId,
      initiatingOwnerUserId: ownerId,
      plan: 'club',
      clientAttemptId: '11111111-1111-4111-8111-111111111143',
    });
    expect(blockedAfterTemporary.outcome).toBe('in_progress');

    const unsafeProvider: BillingProvider = {
      async createCheckoutSession() {
        return { sessionId: 'cs_test_UnsafeResult01', url: 'https://evil.example/c/pay/test' };
      },
      async createPortalSession() {
        return { sessionId: 'bps_UnsafeResult01', url: 'https://evil.example/p/session/test' };
      },
    };
    const unsafeDependencies = dependencies(trialAccount, unsafeProvider);
    expect(
      await createCheckoutSession(
        { ...rejectedInput, clientAttemptId: '11111111-1111-4111-8111-111111111144' },
        owner,
        unsafeDependencies,
      ),
    ).toEqual({ ok: false, error: { code: 'billing_unavailable' } });
    expect(
      (
        await unsafeDependencies.checkoutIntents.reserve({
          organizationId,
          initiatingOwnerUserId: ownerId,
          plan: 'club',
          clientAttemptId: '11111111-1111-4111-8111-111111111145',
        })
      ).outcome,
    ).toBe('in_progress');
  });

  it('keeps the active checkout fence when the canonical deployment origin changes', async () => {
    const provider = new FakeBillingProvider();
    const shared = {
      organizationId,
      organizationSlug,
      plan: 'team' as const,
      clientAttemptId: checkoutAttemptId,
    };
    const first = await createCheckoutSession(
      { ...shared, origin: 'https://app.tryoutflow.test' },
      owner,
      dependencies(trialAccount, provider),
    );
    const moved = await createCheckoutSession(
      {
        ...shared,
        clientAttemptId: '11111111-1111-4111-8111-111111111109',
        origin: 'https://new.tryoutflow.test',
      },
      owner,
      dependencies(trialAccount, provider),
    );
    expect(first.ok).toBe(true);
    expect(moved).toEqual({ ok: false, error: { code: 'checkout_in_progress' } });
    expect(provider.submissions.size).toBe(1);
  });

  it('rejects unknown plans, unsafe origins, and existing live provider subscriptions', async () => {
    const provider = new FakeBillingProvider();
    const invalidPlan = await createCheckoutSession(
      {
        organizationId,
        organizationSlug,
        plan: 'enterprise',
        origin: 'https://app.tryoutflow.test',
        clientAttemptId: checkoutAttemptId,
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
        clientAttemptId: checkoutAttemptId,
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
        clientAttemptId: checkoutAttemptId,
      },
      owner,
      dependencies(trialAccount, provider),
    );
    const active = await createCheckoutSession(
      {
        organizationId,
        organizationSlug,
        plan: 'team',
        origin: 'https://app.tryoutflow.test',
        clientAttemptId: checkoutAttemptId,
      },
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
    const input = {
      organizationId,
      organizationSlug,
      origin: 'https://app.tryoutflow.test',
      clientAttemptId: portalAttemptId,
    };
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
    const deliberateNewClick = await createPortalSession(
      { ...input, clientAttemptId: '11111111-1111-4111-8111-111111111130' },
      owner,
      dependencies(account, provider),
    );
    expect(deliberateNewClick.ok).toBe(true);
    expect(provider.submissions.size).toBe(2);
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
      body: JSON.stringify(
        typeof body === 'object' && body !== null
          ? { clientAttemptId: checkoutAttemptId, ...body }
          : body,
      ),
    });
  const routeDependencies = (account: SubscriptionAccount | null) => ({
    canonicalOrigin,
    provider: new FakeBillingProvider(),
    prices,
    authenticate: async () => ({ actor: owner, organizationSlug }),
    loadOwnedAccount: async () => account,
    checkoutIntents: storeFor(new FakeBillingProvider()),
  });

  it('accepts only bounded same-origin JSON with no body organization scope', async () => {
    const dependencies = routeDependencies(trialAccount);
    const accepted = await handleCheckoutRequest(
      checkoutRequest({ plan: 'team' }),
      organizationId,
      dependencies,
    );
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      sessionId: expect.stringMatching(/^cs_test_/u),
      url: expect.stringMatching(/^https:\/\/checkout[.]stripe[.]com\/c\/pay\/cs_test_/u),
    });
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
    expect(
      (
        await handleCheckoutRequest(
          checkoutRequest({ plan: 'team', clientAttemptId: 'not-a-uuid' }),
          organizationId,
          dependencies,
        )
      ).status,
    ).toBe(400);

    const proxied = checkoutRequest(
      { plan: 'club' },
      {
        host: 'app.tryoutflow.test',
        'x-forwarded-proto': 'https',
      },
    );
    Object.defineProperty(proxied, 'url', {
      value: `http://next-internal:3000/api/organizations/${organizationId}/billing/checkout`,
    });
    expect(
      (await handleCheckoutRequest(proxied, organizationId, routeDependencies(trialAccount)))
        .status,
    ).toBe(200);
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
        body: JSON.stringify({ clientAttemptId: portalAttemptId }),
      },
    );
    const response = await handlePortalRequest(request, organizationId, dependencies);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: expect.stringMatching(/^bps_/u),
      url: expect.stringMatching(/^https:\/\/billing[.]stripe[.]com\/p\/session\/(?:test|live)_/u),
    });
    expect(loads).toBe(1);
    expect(account.plan).toBe('team');
    expect(account.state).toBe('active');
  });
});
