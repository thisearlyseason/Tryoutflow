import { NextResponse, type NextRequest } from 'next/server';

import { createProxySupabaseClient } from './infrastructure/supabase/server';

function signInUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = '';
  url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return url;
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createProxySupabaseClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (request.nextUrl.pathname.startsWith('/app') && !user) {
    return NextResponse.redirect(signInUrl(request));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
