import { NextResponse, type NextRequest } from 'next/server';

import { createAdminSupabaseClient } from '../../../../../infrastructure/supabase/admin';
import { guardPublicJsonRequest } from '../public-request-security';

export async function POST(request: NextRequest) {
  const guarded = await guardPublicJsonRequest(request, {
    bucket: 'confirmation',
    parse(value) {
      if (!value || typeof value !== 'object') return null;
      const token = (value as { token?: unknown }).token;
      if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) return null;
      return { body: { token: token.toLowerCase() }, target: token.toLowerCase() };
    },
  });
  if (!guarded.ok) return NextResponse.json({ status: 'invalid' }, { status: guarded.status });
  try {
    const client = createAdminSupabaseClient();
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
