import { managedBillingCountryAllowed } from '@/modules/subscriptions/providers/managed-billing-country';
import type Stripe from 'stripe';
import { assertManagedPrice } from '@/modules/subscriptions/providers/stripe-managed-payments';
import 'server-only';

import { z } from 'zod';

import {
  isBillingProviderError,
  type BillingProvider,
  type BillingProviderError,
  type CheckoutSessionInput,
  type PortalSessionInput,
  stripeCustomerIdSchema,
  stripePriceIdSchema,
} from './billing-provider';
import { isValidBillingSessionUrl } from './provider-session-url';

const configurationSchema = z.object({
  secretKey: z.string().regex(/^(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{20,300}$/u),
  timeoutMs: z.number().int().min(250).max(60_000).default(10_000),
});
const secureUrlSchema = z.url().refine((value) => value.startsWith('https://'));
const checkoutResponseSchema = z
  .object({
    id: z.string(),
    url: z.string(),
  })
  .strict();
const portalResponseSchema = z
  .object({
    id: z.string(),
    url: z.string(),
  })
  .strict();
const checkoutInputSchema = z.object({
  organizationId: z.uuid(),
  plan: z.enum(['team', 'club', 'association']),
  priceId: stripePriceIdSchema,
  successUrl: secureUrlSchema,
  cancelUrl: secureUrlSchema,
  customerId: z.string().pipe(stripeCustomerIdSchema).optional(),
  checkoutProtocol: z.enum(['standard_tax_v1', 'managed_v1']).optional(),
  billingCountry: z.unknown().optional(),
});
const portalInputSchema = z.object({
  organizationId: z.uuid(),
  customerId: stripeCustomerIdSchema,
  returnUrl: secureUrlSchema,
});
type StripeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const maximumResponseBytes = 64 * 1024;

async function readBoundedJsonResponse(response: Response, signal: AbortSignal) {
  const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mime !== 'application/json') throw new Error('invalid_provider_mime');
  const announced = response.headers.get('content-length');
  if (announced !== null) {
    const size = Number(announced);
    if (!Number.isSafeInteger(size) || size < 0 || size > maximumResponseBytes)
      throw new Error('invalid_provider_size');
  }
  if (!response.body) throw new Error('missing_provider_body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Provider deadline exceeded', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumResponseBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error('provider_body_too_large');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

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
    requireManagedPayments = false,
  ) {
    const controller = new AbortController();
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadlineAt = performance.now() + this.timeoutMs;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DOMException('Provider deadline exceeded', 'AbortError'));
        }, this.timeoutMs);
      });
      const operation = (async () => {
        const response = await this.request(`https://api.stripe.com/v1/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': idempotencyKey,
            ...(requireManagedPayments ? { 'Stripe-Version': '2026-08-26.dahlia' } : {}),
          },
          body: body.toString(),
          signal: combinedSignal,
        });
        // A timer callback can itself be delayed by a busy event loop. The monotonic deadline is
        // authoritative, so abort and fail uncertain before interpreting even an explicit HTTP
        // status that arrived after the caller's delivery window.
        if (performance.now() >= deadlineAt) {
          controller.abort();
          throw new DOMException('Provider deadline exceeded', 'AbortError');
        }
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          throw {
            code: retryable ? 'provider_temporary' : 'provider_rejected',
            retryable,
          } satisfies BillingProviderError;
        }
        const json = await readBoundedJsonResponse(response, combinedSignal);
        if (performance.now() >= deadlineAt) {
          controller.abort();
          throw new DOMException('Provider deadline exceeded', 'AbortError');
        }
        if (
          requireManagedPayments &&
          !z.object({ managed_payments: z.object({ enabled: z.literal(true) }) }).safeParse(json)
            .success
        )
          throw { code: 'provider_configuration', retryable: false } satisfies BillingProviderError;
        if (requireManagedPayments) {
          const expanded = z
            .object({
              line_items: z.object({
                has_more: z.literal(false),
                data: z
                  .array(
                    z.object({
                      quantity: z.literal(1),
                      price: z.object({ id: z.string() }).passthrough(),
                    }),
                  )
                  .length(1),
              }),
            })
            .parse(json);
          const price = expanded.line_items.data[0]!.price;
          if (price.id !== body.get('line_items[0][price]'))
            throw new Error('managed_price_mismatch');
          assertManagedPrice(
            price as unknown as Stripe.Price,
            /^(sk|rk)_live_/.test(this.secretKey),
          );
        }
        const parsed = responseSchema.safeParse(
          requireManagedPayments ? z.object({ id: z.string(), url: z.string() }).parse(json) : json,
        );
        const kind = path === 'checkout/sessions' ? 'checkout' : 'portal';
        if (!parsed.success || !isValidBillingSessionUrl(parsed.data.id, parsed.data.url, kind))
          throw { code: 'delivery_uncertain', retryable: false } satisfies BillingProviderError;
        if (performance.now() >= deadlineAt) {
          controller.abort();
          throw new DOMException('Provider deadline exceeded', 'AbortError');
        }
        return { sessionId: parsed.data.id, url: parsed.data.url };
      })();
      // The single race covers headers, bounded body consumption, decoding, parsing, and schema
      // validation. Promise.race observes a transport that settles late after the caller timed out.
      return await Promise.race([operation, deadline]);
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
    if (
      input.checkoutProtocol === 'managed_v1' &&
      !managedBillingCountryAllowed(input.billingCountry)
    )
      return Promise.reject({
        code: 'provider_rejected',
        retryable: false,
      } satisfies BillingProviderError);
    const body = new URLSearchParams({
      mode: 'subscription',
      ...(input.checkoutProtocol === 'managed_v1'
        ? {
            'managed_payments[enabled]': 'true',
            'subscription_data[metadata][managed_billing_country]': String(input.billingCountry),
            'expand[0]': 'line_items.data.price.product',
            'subscription_data[metadata][tax_protocol]': 'managed_v1',
            ...(process.env.STRIPE_MANAGED_SELLER_COUNTRY === 'CA'
              ? { 'subscription_data[metadata][managed_seller_country]': 'CA' }
              : {}),
          }
        : {}),
      ...(input.checkoutProtocol === 'standard_tax_v1'
        ? {
            'managed_payments[enabled]': 'false',
            'automatic_tax[enabled]': 'true',
            'subscription_data[metadata][tax_protocol]': 'standard_tax_v1',
            billing_address_collection: 'required',
            ...(input.customerId ? { 'customer_update[address]': 'auto' } : {}),
          }
        : {}),
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
      input.checkoutProtocol === 'managed_v1',
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
