// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { FakeBillingProvider } from '../../src/infrastructure/billing/fake-billing-provider';
import {
  billingProviderIdSchema,
  type BillingProvider,
} from '../../src/infrastructure/billing/billing-provider';
import { StripeBillingProvider } from '../../src/infrastructure/billing/stripe-provider';

async function expectBillingProviderContract(factory: () => BillingProvider) {
  const provider = factory();
  const checkout = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    plan: 'team' as const,
    priceId: 'price_team_test',
    successUrl: 'https://app.example.com/billing?checkout=complete',
    cancelUrl: 'https://app.example.com/billing',
  };
  const first = await provider.createCheckoutSession(checkout, 'billing:checkout:one');
  const replay = await provider.createCheckoutSession(checkout, 'billing:checkout:one');
  expect(replay).toEqual(first);

  const portal = await provider.createPortalSession(
    {
      organizationId: checkout.organizationId,
      customerId: 'cus_1234567890abcdef',
      returnUrl: 'https://app.example.com/billing',
    },
    'billing:portal:one',
  );
  expect(portal.url).toMatch(/^https:\/\//u);
}

describe('BillingProvider contract', () => {
  it('provides idempotent checkout and portal sessions', async () => {
    await expectBillingProviderContract(() => new FakeBillingProvider());
  });

  it('validates the shared provider identifier format', () => {
    expect(billingProviderIdSchema.safeParse('cus_1234567890abcdef').success).toBe(true);
    expect(billingProviderIdSchema.safeParse('bad id').success).toBe(false);
  });

  it('sends strict Stripe requests with timeout and idempotency', async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ id: 'cs_test_1234567890', url: 'https://checkout.stripe.com/c/pay/test' }),
    );
    const provider = new StripeBillingProvider(
      { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 1_000 },
      request,
    );
    await expect(
      provider.createCheckoutSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          plan: 'team',
          priceId: 'price_team_test',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
        'billing:checkout:one',
      ),
    ).resolves.toEqual({
      sessionId: 'cs_test_1234567890',
      url: 'https://checkout.stripe.com/c/pay/test',
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': 'billing:checkout:one' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    [400, { code: 'provider_rejected', retryable: false }],
    [408, { code: 'provider_rejected', retryable: false }],
    [429, { code: 'provider_temporary', retryable: true }],
    [503, { code: 'provider_temporary', retryable: true }],
  ] as const)('normalizes HTTP %i without provider content', async (status, expected) => {
    const provider = new StripeBillingProvider(
      { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 1_000 },
      async () => new Response('secret provider body', { status }),
    );
    await expect(
      provider.createPortalSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          customerId: 'cus_1234567890abcdef',
          returnUrl: 'https://app.example.com/billing',
        },
        'billing:portal:one',
      ),
    ).rejects.toEqual(expected);
  });

  it('fails closed on malformed provider success and configuration', async () => {
    expect(() => new StripeBillingProvider({ secretKey: 'short' })).toThrow();
    const provider = new StripeBillingProvider(
      { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 1_000 },
      async () => Response.json({ id: 'bad', url: 'javascript:alert(1)' }),
    );
    await expect(
      provider.createPortalSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          customerId: 'cus_1234567890abcdef',
          returnUrl: 'https://app.example.com/billing',
        },
        'billing:portal:one',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
  });

  it('rejects a valid provider identifier for the wrong session kind', async () => {
    const checkout = new StripeBillingProvider(
      { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 1_000 },
      async () =>
        Response.json({ id: 'bps_1234567890abcdef', url: 'https://billing.stripe.com/test' }),
    );
    await expect(
      checkout.createCheckoutSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          plan: 'team',
          priceId: 'price_team_test',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
        'billing:checkout:wrong-kind',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
  });

  it('enforces a deadline even when transport ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const provider = new StripeBillingProvider(
        { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 250 },
        async () => new Promise<Response>(() => undefined),
      );
      const pending = provider.createPortalSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          customerId: 'cus_1234567890abcdef',
          returnUrl: 'https://app.example.com/billing',
        },
        'billing:portal:deadline',
      );
      const rejection = expect(pending).rejects.toEqual({
        code: 'delivery_uncertain',
        retryable: false,
      });
      await vi.advanceTimersByTimeAsync(250);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
