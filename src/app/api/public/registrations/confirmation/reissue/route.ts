import { NextResponse, type NextRequest } from 'next/server';

import { createAdminSupabaseClient } from '../../../../../../infrastructure/supabase/admin';
import { getDefaultAuthAbuseProtection } from '../../../../../../modules/identity/application/database-auth-abuse-protection';
import {
  canonicalRegistrationText,
  isValidRegistrationEmail,
} from '../../../../../../modules/registration/domain/registration-validation';
import { guardPublicJsonRequest } from '../../public-request-security';

export async function POST(request: NextRequest) {
  const guarded = await guardPublicJsonRequest(request, {
    bucket: 'reissue',
    parse(value) {
      if (!value || typeof value !== 'object') return null;
      const body = value as {
        token?: unknown;
        guardianEmail?: unknown;
        botVerificationToken?: unknown;
      };
      if (
        Object.keys(body).some(
          (key) => !['token', 'guardianEmail', 'botVerificationToken'].includes(key),
        ) ||
        typeof body.token !== 'string' ||
        !/^[0-9a-f]{64}$/iu.test(body.token) ||
        typeof body.guardianEmail !== 'string' ||
        !isValidRegistrationEmail(body.guardianEmail) ||
        typeof body.botVerificationToken !== 'string' ||
        body.botVerificationToken.length < 1 ||
        body.botVerificationToken.length > 2_048
      )
        return null;
      return {
        body: {
          token: body.token.toLowerCase(),
          guardianEmail: canonicalRegistrationText(body.guardianEmail),
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
      scope: 'registration_reissue',
      action: 'registration_reissue',
      // Bind the shared counter to canonical guardian proof, not the
      // attacker-controlled capability, so random token rotation cannot evade it.
      subject: guarded.body.guardianEmail,
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
      p_limit: 5,
    });
    if (contextLimit.error) return NextResponse.json({ status: 'invalid' }, { status: 400 });
    if (contextLimit.data?.[0]?.outcome === 'rate_limited')
      return NextResponse.json({ status: 'rate_limited' }, { status: 429 });
    const limit = await client.rpc('consume_public_registration_rate_limit', {
      p_rate_key_hash: guarded.rateKey,
      p_limit: 5,
    });
    if (limit.error) return NextResponse.json({ status: 'invalid' }, { status: 400 });
    if (limit.data?.[0]?.outcome === 'rate_limited')
      return NextResponse.json({ status: 'rate_limited' }, { status: 429 });
    const result = await client.rpc('reissue_registration_confirmation_token', {
      p_token: guarded.body.token,
      p_guardian_email: guarded.body.guardianEmail,
    });
    const outcome = result.data?.[0];
    if (outcome?.outcome === 'reissued') {
      return NextResponse.json({
        status: 'reissued',
        manualConfirmationToken: outcome.confirmation_token,
      });
    }
    return NextResponse.json({
      status: outcome?.outcome === 'already_confirmed' ? 'already_confirmed' : 'invalid',
    });
  } catch {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }
}
