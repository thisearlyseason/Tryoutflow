import { NextResponse, type NextRequest } from 'next/server';

import { createAdminSupabaseClient } from '../../../../../infrastructure/supabase/admin';

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ status: 'invalid' }, { status: 403 });
  }
  try {
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/i.test(body.token)) {
      return NextResponse.json({ status: 'invalid' }, { status: 400 });
    }
    const result = await createAdminSupabaseClient().rpc(
      'consume_registration_confirmation_token',
      {
        p_token: body.token.toLowerCase(),
      },
    );
    return NextResponse.json({
      status: result.data?.[0]?.outcome === 'consumed' ? 'confirmed' : 'invalid',
    });
  } catch {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }
}
