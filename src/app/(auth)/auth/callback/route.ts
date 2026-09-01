import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '../../../../infrastructure/supabase/server';
import { trustedRequestUrl } from '../../../../lib/request-origin';
import { safeInternalPath } from '../../../../modules/identity/application/sign-in';

function redirectToSignIn(request: NextRequest, error: string) {
  const url = trustedRequestUrl(request, '/sign-in');
  url.searchParams.set('error', error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    return redirectToSignIn(request, 'auth_callback_missing');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectToSignIn(request, 'auth_callback_failed');
  }

  return NextResponse.redirect(
    trustedRequestUrl(request, safeInternalPath(request.nextUrl.searchParams.get('next'))),
  );
}
