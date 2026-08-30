// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { FakeBillingProvider } from '../../src/infrastructure/billing/fake-billing-provider';
import {
  billingProviderIdSchema,
  stripeCustomerIdSchema,
  stripeEventIdSchema,
  stripePriceIdSchema,
  stripeSubscriptionIdSchema,
  type BillingProvider,
} from '../../src/infrastructure/billing/billing-provider';
import { StripeBillingProvider } from '../../src/infrastructure/billing/stripe-provider';

async function expectBillingProviderContract(factory: () => BillingProvider) {
  const provider = factory();
  const checkout = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    plan: 'team' as const,
    priceId: 'price_TeamTest123',
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

  it('validates each canonical Stripe identifier kind without suffix underscores', () => {
    expect(stripeEventIdSchema.safeParse('evt_12345678Ab').success).toBe(true);
    expect(stripeCustomerIdSchema.safeParse('cus_12345678Ab').success).toBe(true);
    expect(stripeSubscriptionIdSchema.safeParse('sub_12345678Ab').success).toBe(true);
    expect(stripePriceIdSchema.safeParse('price_12345678Ab').success).toBe(true);
    expect(stripeEventIdSchema.safeParse('cus_12345678Ab').success).toBe(false);
    expect(stripeCustomerIdSchema.safeParse('cus_1234_678Ab').success).toBe(false);
    expect(stripeSubscriptionIdSchema.safeParse('sub_1234567').success).toBe(false);
    expect(stripePriceIdSchema.safeParse('price_12345678-').success).toBe(false);
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
          priceId: 'price_TeamTest123',
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
    ['checkout', 'https://evil.example/c/pay/test'],
    ['checkout', 'https://checkout.stripe.com:8443/c/pay/test'],
    ['checkout', 'https://checkout.stripe.com/not-checkout/test'],
    ['portal', 'https://evil.example/p/session/test'],
    ['portal', 'https://billing.stripe.com:8443/p/session/test'],
    ['portal', 'https://billing.stripe.com/not-portal/test'],
  ] as const)('rejects an unexpected %s redirect contract: %s', async (kind, url) => {
    const provider = new StripeBillingProvider(
      { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 1_000 },
      async () =>
        Response.json({
          id: kind === 'checkout' ? 'cs_test_1234567890' : 'bps_1234567890abcdef',
          url,
        }),
    );
    const pending =
      kind === 'checkout'
        ? provider.createCheckoutSession(
            {
              organizationId: '11111111-1111-4111-8111-111111111111',
              plan: 'team',
              priceId: 'price_TeamTest123',
              successUrl: 'https://app.example.com/success',
              cancelUrl: 'https://app.example.com/cancel',
            },
            `billing:checkout:redirect-${url}`,
          )
        : provider.createPortalSession(
            {
              organizationId: '11111111-1111-4111-8111-111111111111',
              customerId: 'cus_1234567890abcdef',
              returnUrl: 'https://app.example.com/billing',
            },
            `billing:portal:redirect-${url}`,
          );
    await expect(pending).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
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

  it.each([200, 400, 408, 429, 500])(
    'treats a late HTTP %i result as uncertain before status classification',
    async (status) => {
      vi.useFakeTimers();
      const performanceSpy = vi.spyOn(performance, 'now');
      try {
        let resolveRequest!: (response: Response) => void;
        let observedSignal: AbortSignal | undefined;
        performanceSpy.mockReturnValueOnce(1_000).mockReturnValue(1_251);
        const provider = new StripeBillingProvider(
          { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 250 },
          async (_input, init) => {
            observedSignal = init?.signal ?? undefined;
            return new Promise<Response>((resolve) => {
              resolveRequest = resolve;
            });
          },
        );
        const pending = provider.createPortalSession(
          {
            organizationId: '11111111-1111-4111-8111-111111111111',
            customerId: 'cus_1234567890abcdef',
            returnUrl: 'https://app.example.com/billing',
          },
          `billing:portal:late-${status}`,
        );
        resolveRequest(
          status === 200
            ? Response.json({
                id: 'bps_1234567890abcdef',
                url: 'https://billing.stripe.com/p/session/test',
              })
            : new Response(null, { status }),
        );
        await expect(pending).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
        expect(observedSignal?.aborted).toBe(true);
      } finally {
        performanceSpy.mockRestore();
        vi.useRealTimers();
      }
    },
  );

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
        Response.json({
          id: 'bps_1234567890abcdef',
          url: 'https://billing.stripe.com/p/session/test',
        }),
    );
    await expect(
      checkout.createCheckoutSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          plan: 'team',
          priceId: 'price_TeamTest123',
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

  it('enforces the same deadline while a successful response body stalls and aborts the transport', async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"bps_1234567890abcdef","url":'));
        },
      });
      const provider = new StripeBillingProvider(
        { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 250 },
        async (_input, init) => {
          observedSignal = init?.signal ?? undefined;
          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      );
      const pending = provider.createPortalSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          customerId: 'cus_1234567890abcdef',
          returnUrl: 'https://app.example.com/billing',
        },
        'billing:portal:body-deadline',
      );
      const rejection = expect(pending).rejects.toEqual({
        code: 'delivery_uncertain',
        retryable: false,
      });
      await vi.advanceTimersByTimeAsync(250);
      await rejection;
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      'text/plain',
      '{"id":"bps_1234567890abcdef","url":"https://billing.stripe.com/p/session/test"}',
    ],
    ['application/json', `{"padding":"${'x'.repeat(70_000)}"}`],
  ])('rejects unsafe provider response %s bodies', async (contentType, body) => {
    const provider = new StripeBillingProvider(
      { secretKey: `sk_test_${'x'.repeat(32)}`, timeoutMs: 1_000 },
      async () => new Response(body, { headers: { 'content-type': contentType } }),
    );
    await expect(
      provider.createPortalSession(
        {
          organizationId: '11111111-1111-4111-8111-111111111111',
          customerId: 'cus_1234567890abcdef',
          returnUrl: 'https://app.example.com/billing',
        },
        'billing:portal:unsafe-response',
      ),
    ).rejects.toEqual({ code: 'delivery_uncertain', retryable: false });
  });
});
