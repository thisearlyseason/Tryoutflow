import { NextResponse, type NextRequest } from 'next/server';
import { trustedRequestUrl } from '@/lib/request-origin';
import { NATIVE_CONTEXT_COOKIE } from '@/modules/identity/native-context';
export async function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get('platform');
  if (platform !== 'apple' && platform !== 'google')
    return new NextResponse('Unsupported device.', { status: 400 });
  const next = request.nextUrl.searchParams.get('next') ?? '/app';
  if (next !== '/app' && !/^\/app\/[a-zA-Z0-9/_-]+$/.test(next))
    return new NextResponse('Unsupported workspace path.', { status: 400 });
  const response = NextResponse.redirect(trustedRequestUrl(request, next), 303);
  response.cookies.set(NATIVE_CONTEXT_COOKIE, platform, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
