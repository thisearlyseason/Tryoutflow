import { createHmac } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { createAdminSupabaseClient } from '../../../../infrastructure/supabase/admin';
import type { Json } from '../../../../infrastructure/supabase/database.types';
import { getServerEnvironment } from '../../../../lib/env';
import { noRegistrationConfirmationNotifier } from '../../../../modules/registration/application/registration-confirmation-notifier';
import { registerAthlete } from '../../../../modules/registration/application/register-athlete';
import { RegistrationFormSchema } from '../../../../modules/registration/domain/form-schema';

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
  const address = forwarded?.trim() || local?.trim();
  if (!address && process.env.NODE_ENV === 'production') return null;
  const context = `${slug}|${address ?? 'local'}`;
  return createHmac('sha256', getServerEnvironment().PUBLIC_REGISTRATION_RATE_LIMIT_SECRET)
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
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json'
  ) {
    return genericError(403);
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) return genericError(413);

  let body: { tryoutSlug?: unknown; submission?: unknown; idempotencyKey?: unknown };
  try {
    const raw = await readBodyWithinLimit(request);
    if (raw === null) return genericError(413);
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
    const client = createAdminSupabaseClient();
    const configuration = await client.rpc('public_registration_tryout', {
      p_tryout_slug: body.tryoutSlug,
    });
    const row = configuration.data?.[0];
    if (configuration.error || !row) return genericError(400);
    await registerAthlete(
      {
        tryoutSlug: body.tryoutSlug,
        idempotencyKey: body.idempotencyKey,
        submission: body.submission,
      },
      {
        form: RegistrationFormSchema.parse(row.form_schema),
        notifier: noRegistrationConfirmationNotifier,
        gateway: {
          async submit(input) {
            const result = await client.rpc('submit_public_registration', {
              p_tryout_slug: input.tryoutSlug,
              p_submission: input.submission as Json,
              p_idempotency_key: input.idempotencyKey,
              p_rate_key_hash: rateKey,
            });
            const outcome = result.data?.[0];
            if (result.error || !outcome || outcome.outcome === 'registration_closed')
              throw new Error('closed');
            if (outcome.outcome === 'rate_limited') throw new Error('rate_limited');
            if (outcome.outcome === 'idempotency_conflict') throw new Error('idempotency_conflict');
            if (outcome.outcome === 'replayed') return { outcome: 'replayed' as const };
            return {
              outcome: 'submitted' as const,
              registrationId: outcome.registration_id,
              confirmationToken: outcome.confirmation_token,
            };
          },
        },
      },
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'rate_limited') return genericError(429);
    return genericError(400);
  }
}

async function readBodyWithinLimit(request: NextRequest): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > MAX_BODY_BYTES) return null;
    chunks.push(next.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}
