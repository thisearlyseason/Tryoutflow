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
  const proxyClient = createProxySupabaseClient(request);
  const {
    data: { user },
  } = await proxyClient.supabase.auth.getUser();

  if (
    (request.nextUrl.pathname === '/app' || request.nextUrl.pathname.startsWith('/app/')) &&
    !user
  ) {
    const redirectResponse = NextResponse.redirect(signInUrl(request));
    proxyClient
      .response()
      .cookies.getAll()
      .forEach(({ name, value, ...options }) => {
        redirectResponse.cookies.set(name, value, options);
      });
    return redirectResponse;
  }

  return proxyClient.response();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
