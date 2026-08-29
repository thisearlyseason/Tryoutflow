import { createHash } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { createAdminSupabaseClient } from '../../../../infrastructure/supabase/admin';
import type { Json } from '../../../../infrastructure/supabase/database.types';
import { noRegistrationConfirmationNotifier } from '../../../../modules/registration/application/registration-confirmation-notifier';
import { registerAthlete } from '../../../../modules/registration/application/register-athlete';
import { RegistrationFormSchema } from '../../../../modules/registration/domain/form-schema';
import { guardPublicJsonRequest } from './public-request-security';

function genericError(status: number) {
  return NextResponse.json(
    { error: 'We could not process that registration. Please try again.' },
    { status },
  );
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
  const guarded = await guardPublicJsonRequest(request, {
    bucket: 'registration',
    parse(value) {
      if (!value || typeof value !== 'object') return null;
      const body = value as {
        tryoutSlug?: unknown;
        submission?: unknown;
        idempotencyKey?: unknown;
      };
      if (
        typeof body.tryoutSlug !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(body.tryoutSlug) ||
        typeof body.idempotencyKey !== 'string' ||
        !/^[A-Za-z0-9_-]{24,200}$/u.test(body.idempotencyKey) ||
        !body.submission ||
        typeof body.submission !== 'object'
      )
        return null;
      return {
        body: {
          tryoutSlug: body.tryoutSlug,
          idempotencyKey: body.idempotencyKey,
          submission: body.submission,
        },
        target: body.tryoutSlug,
      };
    },
  });
  if (!guarded.ok) return genericError(guarded.status);
  const body = guarded.body;

  try {
    const client = createAdminSupabaseClient();
    const contextLimit = await client.rpc('consume_public_registration_rate_limit', {
      p_rate_key_hash: guarded.contextRateKey,
      p_limit: 10,
    });
    if (contextLimit.error) return genericError(400);
    if (contextLimit.data?.[0]?.outcome === 'rate_limited') return genericError(429);
    const configuration = await client.rpc('public_registration_tryout', {
      p_tryout_slug: body.tryoutSlug,
    });
    const row = configuration.data?.[0];
    if (configuration.error || !row) return genericError(400);
    const limit = await client.rpc('consume_public_registration_rate_limit', {
      p_rate_key_hash: guarded.rateKey,
      p_limit: 10,
    });
    if (limit.error) return genericError(400);
    if (limit.data?.[0]?.outcome === 'rate_limited') return genericError(429);
    const transactionRateKey = createHash('sha256')
      .update(`registration-transaction|${guarded.rateKey}`)
      .digest('hex');
    const command = await registerAthlete(
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
            const result = await client.rpc('submit_public_registration_with_phone', {
              p_tryout_slug: input.tryoutSlug,
              p_submission: input.submission as Json,
              p_idempotency_key: input.idempotencyKey,
              p_rate_key_hash: transactionRateKey,
            });
            const outcome = result.data?.[0];
            if (result.error || !outcome || outcome.outcome === 'registration_closed')
              throw new Error('closed');
            if (outcome.outcome === 'rate_limited') throw new Error('rate_limited');
            if (outcome.outcome === 'idempotency_conflict') throw new Error('idempotency_conflict');
            if (outcome.outcome === 'replayed')
              return {
                outcome: 'replayed' as const,
                registrationId: outcome.registration_id,
                confirmationToken: outcome.confirmation_token,
              };
            return {
              outcome: 'submitted' as const,
              registrationId: outcome.registration_id,
              confirmationToken: outcome.confirmation_token,
            };
          },
        },
      },
    );
    return NextResponse.json({ ok: true, manualConfirmationToken: command.confirmationToken });
  } catch (error) {
    if (error instanceof Error && error.message === 'rate_limited') return genericError(429);
    return genericError(400);
  }
}
