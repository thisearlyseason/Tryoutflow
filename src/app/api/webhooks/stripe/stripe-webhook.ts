import { launchManagedCoverage } from '@/modules/subscriptions/providers/stripe-managed-coverage';
import { taxCalculationComplete } from '@/modules/subscriptions/providers/stripe-tax';
import { stripeBillingClient } from '@/modules/subscriptions/providers/stripe';
import { createHash } from 'node:crypto';

import Stripe from 'stripe';

import { createAdminSupabaseClient } from '../../../../infrastructure/supabase/admin';
import { getStripeWebhookEnvironment } from '../../../../lib/env';
import { SystemClock, type Clock } from '../../../../lib/clock';
import {
  applyStripeEvent,
  parseStripeSubscriptionEvent,
  type SubscriptionEventRpcClient,
} from '../../../../modules/subscriptions/application/apply-stripe-event';
import { getStripePriceMapping } from '../../../../modules/subscriptions/domain/plans';

const maximumBodyBytes = 64 * 1024;
const signatureToleranceSeconds = 5 * 60;
// A small positive skew admits ordinary clock drift without accepting far-future signed replays.
const signatureFutureSkewSeconds = 30;

export function parseStripeSignatureTimestamp(signature: string, clock: Clock) {
  const timestamps: string[] = [];
  for (const component of signature.split(',')) {
    const separator = component.indexOf('=');
    if (separator <= 0) continue;
    const key = component.slice(0, separator).trim();
    const value = component.slice(separator + 1).trim();
    if (key === 't') timestamps.push(value);
  }
  if (timestamps.length !== 1 || !/^(?:0|[1-9][0-9]*)$/u.test(timestamps[0]!))
    throw new Error('invalid_signature_timestamp');
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp)) throw new Error('invalid_signature_timestamp');
  const now = Math.floor(clock.now().getTime() / 1_000);
  if (!Number.isSafeInteger(now)) throw new Error('invalid_clock');
  if (now - timestamp > signatureToleranceSeconds || timestamp - now > signatureFutureSkewSeconds)
    throw new Error('signature_timestamp_out_of_range');
  return timestamp;
}

export async function readBoundedStripeBody(request: Request, maximumBytes = maximumBodyBytes) {
  const announced = request.headers.get('content-length');
  if (announced !== null) {
    const size = Number(announced);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid_content_length');
    if (size > maximumBytes) throw new Error('body_too_large');
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error('body_too_large');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

type StripeWebhookDependencies = {
  environment?: Record<string, string | undefined>;
  client?: SubscriptionEventRpcClient;
  clock?: Clock;
};

export async function handleStripeWebhook(
  request: Request,
  dependencies: StripeWebhookDependencies = {},
) {
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  )
    return Response.json({ error: 'invalid_request' }, { status: 415 });
  const signature = request.headers.get('stripe-signature');
  if (!signature || signature.length > 2_000)
    return Response.json({ error: 'invalid_webhook' }, { status: 400 });
  const clock = dependencies.clock ?? new SystemClock();
  try {
    parseStripeSignatureTimestamp(signature, clock);
  } catch {
    return Response.json({ error: 'invalid_webhook' }, { status: 400 });
  }
  let body: Uint8Array;
  try {
    body = await readBoundedStripeBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === 'body_too_large')
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    return Response.json({ error: 'invalid_webhook' }, { status: 400 });
  }
  let environment: ReturnType<typeof getStripeWebhookEnvironment>;
  let prices: ReturnType<typeof getStripePriceMapping>;
  try {
    environment = getStripeWebhookEnvironment(dependencies.environment);
    prices = getStripePriceMapping(dependencies.environment);
  } catch {
    return Response.json({ error: 'webhook_unavailable' }, { status: 500 });
  }
  let verified: Stripe.Event;
  try {
    // Stripe's maintained implementation verifies every v1 signature over the exact bytes and
    // enforces the supplied tolerance. Never JSON-parse or reserialize before this boundary.
    const stripe = new Stripe(`sk_test_${'x'.repeat(32)}`);
    verified = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      environment.STRIPE_WEBHOOK_SECRET,
      signatureToleranceSeconds,
      undefined,
      Math.floor(clock.now().getTime() / 1_000),
    );
  } catch {
    return Response.json({ error: 'invalid_webhook' }, { status: 400 });
  }
  // New-catalog subscriptions have a separate verified handler and must not mutate legacy accounts.
  if (
    verified.type.startsWith('customer.subscription.') &&
    (verified.data.object as Stripe.Subscription).metadata?.billing_version === '2'
  ) {
    return Response.json({ outcome: 'new_catalog_subscription' });
  }
  // Tax-enabled legacy subscriptions must not grant access from status alone.
  const legacySub = verified.data.object as Stripe.Subscription;
  if (
    verified.type.startsWith('customer.subscription.') &&
    ['active', 'trialing'].includes(legacySub.status) &&
    (legacySub.automatic_tax?.enabled ||
      ['standard_tax_v1', 'managed_v1'].includes(legacySub.metadata?.tax_protocol ?? ''))
  ) {
    try {
      if (
        legacySub.metadata?.tax_protocol === 'managed_v1' &&
        legacySub.managed_payments?.enabled !== true
      )
        throw new Error('managed_subscription_not_verified');
      const id =
        typeof legacySub.latest_invoice === 'string'
          ? legacySub.latest_invoice
          : legacySub.latest_invoice?.id;
      if (!id) throw new Error('missing_tax_invoice');
      const invoice = await stripeBillingClient().invoices.retrieve(id);
      if (
        legacySub.metadata?.tax_protocol === 'managed_v1' &&
        !launchManagedCoverage(
          legacySub.metadata.managed_seller_country,
          invoice.customer_address?.country,
        )
      )
        throw new Error('managed_coverage_not_verified');
      const invoiceSub = invoice.parent?.subscription_details?.subscription;
      if (
        invoice.livemode !== verified.livemode ||
        (typeof invoiceSub === 'string' ? invoiceSub : invoiceSub?.id) !== legacySub.id ||
        invoice.status !== 'paid' ||
        !taxCalculationComplete(invoice.automatic_tax, true)
      )
        throw new Error('unverified_tax_invoice');
    } catch {
      return Response.json({ error: 'tax_verification_pending' }, { status: 503 });
    }
  }
  let parsed: ReturnType<typeof parseStripeSubscriptionEvent>;
  try {
    parsed = parseStripeSubscriptionEvent(verified, prices);
  } catch {
    return Response.json({ error: 'invalid_webhook' }, { status: 400 });
  }
  try {
    const outcome = await applyStripeEvent(
      {
        ...parsed,
        payloadDigest: createHash('sha256').update(body).digest('hex'),
      },
      dependencies.client ?? createAdminSupabaseClient(),
    );
    return Response.json({ outcome }, { status: outcome === 'event_conflict' ? 409 : 200 });
  } catch {
    return Response.json({ error: 'webhook_unavailable' }, { status: 500 });
  }
}
