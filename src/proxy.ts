import { NextResponse, type NextRequest } from 'next/server';

import {
  createProxySupabaseClient,
  hasSupabaseSessionCookie,
} from './infrastructure/supabase/server';
import { trustedRequestUrl } from './lib/request-origin';
import { organizationRoutePreflight } from './modules/organizations/application/organization-route-preflight';

const publicMarketingPaths = new Set([
  '/',
  '/features',
  '/for/teams',
  '/for/clubs',
  '/for/associations',
  '/pricing',
  '/demo',
  '/how-to',
  '/privacy',
  '/terms',
  '/fonts/manrope/Manrope-Variable.ttf',
]);

function isPublicMarketingPathname(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return publicMarketingPaths.has(normalized);
}

function signInUrl(request: NextRequest): URL {
  const url = trustedRequestUrl(request, '/sign-in');
  url.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return url;
}

export async function proxy(request: NextRequest) {
  const publicMarketingPath = isPublicMarketingPathname(request.nextUrl.pathname);
  if (
    publicMarketingPath &&
    (request.nextUrl.pathname.startsWith('/fonts/') ||
      !hasSupabaseSessionCookie(request.cookies.getAll()))
  )
    return NextResponse.next({ request });

  const proxyClient = createProxySupabaseClient(request);
  const {
    data: { user },
  } = await proxyClient.supabase.auth.getUser();

  if (publicMarketingPath) {
    // Refresh here, before rendering: Server Components cannot persist rotated tokens.
    const response = proxyClient.response();
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  const protectedApplicationPath =
    request.nextUrl.pathname === '/app' ||
    request.nextUrl.pathname.startsWith('/app/') ||
    request.nextUrl.pathname === '/platform' ||
    request.nextUrl.pathname.startsWith('/platform/');
  if (protectedApplicationPath && !user) {
    const redirectResponse = NextResponse.redirect(signInUrl(request));
    proxyClient
      .response()
      .cookies.getAll()
      .forEach(({ name, value, ...options }) => {
        redirectResponse.cookies.set(name, value, options);
      });
    return redirectResponse;
  }

  if (
    user &&
    request.nextUrl.pathname.startsWith('/app/') &&
    !(await organizationRoutePreflight(proxyClient.supabase, user.id, request.nextUrl))
  ) {
    const denied = new NextResponse('Page not found.', { status: 404 });
    denied.headers.set('Cache-Control', 'private, no-store');
    proxyClient
      .response()
      .cookies.getAll()
      .forEach(({ name, value, ...options }) => {
        denied.cookies.set(name, value, options);
      });
    return denied;
  }

  return proxyClient.response();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
