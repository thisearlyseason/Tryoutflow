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
  const clock = dependencies.clock ?? new SystemClock();
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

export async function POST(request: Request) {
  return handleStripeWebhook(request);
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
