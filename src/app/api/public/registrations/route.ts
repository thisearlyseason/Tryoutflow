import { createHmac } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { createAdminSupabaseClient } from '../../../../infrastructure/supabase/admin';
import type { Json } from '../../../../infrastructure/supabase/database.types';
import { getServerEnvironment } from '../../../../lib/env';
import { noRegistrationConfirmationNotifier } from '../../../../modules/registration/application/registration-confirmation-notifier';

const MAX_BODY_BYTES = 32 * 1024;

function genericError(status: number) {
  return NextResponse.json(
    { error: 'We could not process that registration. Please try again.' },
    { status },
  );
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  return origin !== null && origin === request.nextUrl.origin;
}

function trustedRequestKey(request: NextRequest, slug: string) {
  const forwarded = request.headers.get('x-vercel-forwarded-for');
  const local =
    process.env.NODE_ENV !== 'production' ? request.headers.get('x-forwarded-for') : null;
  const address = forwarded?.split(',')[0]?.trim() || local?.split(',')[0]?.trim();
  if (!address && process.env.NODE_ENV === 'production') return null;
  const context = `${slug}|${address ?? 'local'}|${request.headers.get('user-agent') ?? ''}`;
  return createHmac('sha256', getServerEnvironment().SUPABASE_SERVICE_ROLE_KEY)
    .update(context)
    .digest('hex');
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('tryoutSlug');
  if (!slug || slug.length > 63) return genericError(404);
  try {
    const result = await createAdminSupabaseClient().rpc('public_registration_tryout', {
      p_tryout_slug: slug,
    });
    const row = result.data?.[0];
    if (result.error || !row) return genericError(404);
    return NextResponse.json({
      tryout: {
        name: row.name,
        slug: row.slug,
        formSchema: row.form_schema,
        divisions: row.divisions,
      },
    });
  } catch {
    return genericError(404);
  }
}

export async function POST(request: NextRequest) {
  if (
    !sameOrigin(request) ||
    !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')
  ) {
    return genericError(403);
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) return genericError(413);

  let body: { tryoutSlug?: unknown; submission?: unknown; idempotencyKey?: unknown };
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return genericError(413);
    body = JSON.parse(raw) as typeof body;
  } catch {
    return genericError(400);
  }
  if (
    typeof body.tryoutSlug !== 'string' ||
    typeof body.idempotencyKey !== 'string' ||
    !body.submission ||
    body.idempotencyKey.length < 24
  ) {
    return genericError(400);
  }
  const rateKey = trustedRequestKey(request, body.tryoutSlug);
  if (!rateKey) return genericError(400);

  try {
    const result = await createAdminSupabaseClient().rpc('submit_public_registration', {
      p_tryout_slug: body.tryoutSlug,
      p_submission: body.submission as Json,
      p_idempotency_key: body.idempotencyKey,
      p_rate_key_hash: rateKey,
    });
    const outcome = result.data?.[0];
    if (result.error || !outcome) return genericError(400);
    if (outcome.outcome === 'rate_limited') return genericError(429);
    if (outcome.outcome === 'registration_closed') return genericError(400);
    const guardianEmail =
      typeof (body.submission as { guardian?: { email?: unknown } }).guardian?.email === 'string'
        ? (body.submission as { guardian: { email: string } }).guardian.email
        : '';
    if (
      outcome.outcome === 'submitted' &&
      outcome.confirmation_token &&
      outcome.registration_id &&
      guardianEmail
    ) {
      // The Task 22 outbox adapter owns actual delivery. Never tell a guardian
      // an email was sent until an adapter has accepted the durable job.
      await noRegistrationConfirmationNotifier.enqueue({
        registrationId: outcome.registration_id,
        confirmationToken: outcome.confirmation_token,
        guardianEmail,
      });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return genericError(400);
  }
}
