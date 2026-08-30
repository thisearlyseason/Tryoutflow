import { Resend } from 'resend';

import {
  parseResendEvent,
  recordDeliveryEvent,
} from '../../../../modules/communications/application/apply-delivery-event';
import { createAdminSupabaseClient } from '../../../../infrastructure/supabase/admin';
import { getResendWebhookEnvironment } from '../../../../lib/env';

const maximumBodyBytes = 64 * 1024;
const signatureToleranceSeconds = 5 * 60;

export async function readBoundedRawBody(request: Request, maximumBytes = maximumBodyBytes) {
  const announced = request.headers.get('content-length');
  if (announced !== null) {
    const size = Number(announced);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid_content_length');
    if (size > maximumBytes) throw new Error('body_too_large');
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
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
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

function verifiedHeaders(request: Request) {
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (
    !id ||
    !/^msg_[A-Za-z0-9_-]{8,200}$/u.test(id) ||
    !timestamp ||
    !/^\d{10}$/u.test(timestamp) ||
    !signature ||
    signature.length > 2_000
  ) {
    throw new Error('invalid_headers');
  }
  const timestampSeconds = Number(timestamp);
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > signatureToleranceSeconds) {
    throw new Error('expired_signature');
  }
  return { id, timestamp, signature };
}

export async function POST(request: Request) {
  if (request.headers.get('content-type')?.toLowerCase() !== 'application/json') {
    return Response.json({ error: 'invalid_request' }, { status: 415 });
  }
  try {
    const headers = verifiedHeaders(request);
    const rawBody = await readBoundedRawBody(request);
    const environment = getResendWebhookEnvironment();
    const resend = new Resend(environment.RESEND_API_KEY);
    const verified = await resend.webhooks.verify({
      payload: rawBody,
      headers,
      webhookSecret: environment.RESEND_WEBHOOK_SECRET,
    });
    const event = parseResendEvent(verified);
    const outcome = await recordDeliveryEvent(headers.id, event, createAdminSupabaseClient());
    if (outcome === 'not_found') return Response.json({ outcome }, { status: 409 });
    if (['invalid_input', 'event_conflict', 'provider_conflict'].includes(outcome)) {
      return Response.json({ error: 'invalid_event' }, { status: 400 });
    }
    return Response.json({ outcome: outcome === 'replayed' ? 'replayed' : 'accepted' });
  } catch (error) {
    if (error instanceof Error && error.message === 'body_too_large') {
      return Response.json({ error: 'payload_too_large' }, { status: 413 });
    }
    return Response.json({ error: 'invalid_webhook' }, { status: 400 });
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
