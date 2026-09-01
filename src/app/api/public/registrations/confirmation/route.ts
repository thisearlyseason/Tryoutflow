import { NextResponse, type NextRequest } from 'next/server';

import { createAdminSupabaseClient } from '../../../../../infrastructure/supabase/admin';
import { getDefaultAuthAbuseProtection } from '../../../../../modules/identity/application/database-auth-abuse-protection';
import { guardPublicJsonRequest } from '../public-request-security';

export async function POST(request: NextRequest) {
  const guarded = await guardPublicJsonRequest(request, {
    bucket: 'confirmation',
    parse(value) {
      if (!value || typeof value !== 'object') return null;
      const body = value as { token?: unknown; botVerificationToken?: unknown };
      if (
        Object.keys(body).some((key) => !['token', 'botVerificationToken'].includes(key)) ||
        typeof body.token !== 'string' ||
        !/^[0-9a-f]{64}$/iu.test(body.token) ||
        typeof body.botVerificationToken !== 'string' ||
        body.botVerificationToken.length < 1 ||
        body.botVerificationToken.length > 2_048
      )
        return null;
      return {
        body: {
          token: body.token.toLowerCase(),
          botVerificationToken: body.botVerificationToken,
        },
        target: body.token.toLowerCase(),
      };
    },
  });
  if (!guarded.ok) return NextResponse.json({ status: 'invalid' }, { status: guarded.status });
  try {
    const client = createAdminSupabaseClient();
    const abuseDecision = await getDefaultAuthAbuseProtection().check({
      scope: 'registration_confirmation',
      action: 'registration_confirmation',
      // Confirmation capabilities are attacker-controlled. Keep the shared subject
      // stable so token rotation cannot create an unbounded counter or evade the
      // trusted-address limit; neither the capability nor address is stored raw.
      subject: 'registration-confirmation-capability',
      token: guarded.body.botVerificationToken,
      requestContext: guarded.requestContext,
    });
    if (!abuseDecision.allowed)
      return NextResponse.json(
        { status: abuseDecision.reason === 'rate_limited' ? 'rate_limited' : 'invalid' },
        { status: abuseDecision.reason === 'rate_limited' ? 429 : 400 },
      );
    const contextLimit = await client.rpc('consume_public_registration_rate_limit', {
      p_rate_key_hash: guarded.contextRateKey,
      p_limit: 10,
    });
    if (contextLimit.error) return NextResponse.json({ status: 'invalid' }, { status: 400 });
    if (contextLimit.data?.[0]?.outcome === 'rate_limited')
      return NextResponse.json({ status: 'rate_limited' }, { status: 429 });
    const limit = await client.rpc('consume_public_registration_rate_limit', {
      p_rate_key_hash: guarded.rateKey,
      p_limit: 10,
    });
    if (limit.error) return NextResponse.json({ status: 'invalid' }, { status: 400 });
    if (limit.data?.[0]?.outcome === 'rate_limited')
      return NextResponse.json({ status: 'rate_limited' }, { status: 429 });
    const result = await client.rpc('consume_registration_confirmation_token', {
      p_token: guarded.body.token,
    });
    const outcome = result.data?.[0]?.outcome;
    const status =
      outcome === 'confirmed' || outcome === 'already_confirmed' || outcome === 'expired'
        ? outcome
        : 'invalid';
    return NextResponse.json({ status });
  } catch {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }
}
