import 'server-only';

import { z } from 'zod';

import {
  isBillingProviderError,
  type BillingProvider,
  type BillingProviderError,
  type CheckoutSessionInput,
  type PortalSessionInput,
} from './billing-provider';

const configurationSchema = z.object({
  secretKey: z.string().regex(/^sk_(?:test|live)_[A-Za-z0-9]{20,300}$/u),
  timeoutMs: z.number().int().min(250).max(60_000).default(10_000),
});
const secureUrlSchema = z.url().refine((value) => value.startsWith('https://'));
const checkoutResponseSchema = z
  .object({
    id: z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9_]{8,200}$/u),
    url: secureUrlSchema,
  })
  .strict();
const portalResponseSchema = z
  .object({ id: z.string().regex(/^bps_[A-Za-z0-9_]{8,200}$/u), url: secureUrlSchema })
  .strict();
const checkoutInputSchema = z.object({
  organizationId: z.uuid(),
  plan: z.enum(['team', 'club', 'association']),
  priceId: z.string().regex(/^price_[A-Za-z0-9_]{6,200}$/u),
  successUrl: secureUrlSchema,
  cancelUrl: secureUrlSchema,
  customerId: z
    .string()
    .regex(/^cus_[A-Za-z0-9]{8,200}$/u)
    .optional(),
});
const portalInputSchema = z.object({
  organizationId: z.uuid(),
  customerId: z.string().regex(/^cus_[A-Za-z0-9]{8,200}$/u),
  returnUrl: secureUrlSchema,
});
type StripeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class StripeBillingProvider implements BillingProvider {
  private readonly secretKey: string;
  private readonly timeoutMs: number;
  private readonly request: StripeFetch;

  constructor(configuration: unknown, request: StripeFetch = fetch) {
    const parsed = configurationSchema.safeParse(configuration);
    if (!parsed.success)
      throw { code: 'provider_configuration', retryable: false } satisfies BillingProviderError;
    this.secretKey = parsed.data.secretKey;
    this.timeoutMs = parsed.data.timeoutMs;
    this.request = request;
  }

  private async post(
    path: string,
    body: URLSearchParams,
    idempotencyKey: string,
    responseSchema: typeof checkoutResponseSchema | typeof portalResponseSchema,
    signal?: AbortSignal,
  ) {
    const controller = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DOMException('Provider deadline exceeded', 'AbortError'));
        }, this.timeoutMs);
      });
      const request = this.request(`https://api.stripe.com/v1/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': idempotencyKey,
        },
        body: body.toString(),
        signal: combinedSignal,
      });
      // Promise.race enforces the deadline even when an injected/custom fetch ignores abort.
      const response = await Promise.race([request, deadline]);
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw {
          code: retryable ? 'provider_temporary' : 'provider_rejected',
          retryable,
        } satisfies BillingProviderError;
      }
      const parsed = responseSchema.safeParse((await response.json()) as unknown);
      if (!parsed.success)
        throw { code: 'delivery_uncertain', retryable: false } satisfies BillingProviderError;
      return { sessionId: parsed.data.id, url: parsed.data.url };
    } catch (error) {
      if (isBillingProviderError(error)) throw error;
      throw { code: 'delivery_uncertain', retryable: false } satisfies BillingProviderError;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  createCheckoutSession(
    input: CheckoutSessionInput,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ) {
    const parsed = checkoutInputSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject({
        code: 'provider_rejected',
        retryable: false,
      } satisfies BillingProviderError);
    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': '1',
      'subscription_data[metadata][organization_id]': input.organizationId,
      'subscription_data[metadata][plan_key]': input.plan,
      ...(input.customerId ? { customer: input.customerId } : {}),
    });
    return this.post(
      'checkout/sessions',
      body,
      idempotencyKey,
      checkoutResponseSchema,
      options?.signal,
    );
  }

  createPortalSession(
    input: PortalSessionInput,
    idempotencyKey: string,
    options?: { signal?: AbortSignal },
  ) {
    const parsed = portalInputSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject({
        code: 'provider_rejected',
        retryable: false,
      } satisfies BillingProviderError);
    return this.post(
      'billing_portal/sessions',
      new URLSearchParams({ customer: input.customerId, return_url: input.returnUrl }),
      idempotencyKey,
      portalResponseSchema,
      options?.signal,
    );
  }
}
