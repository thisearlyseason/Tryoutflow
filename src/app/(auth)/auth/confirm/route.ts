import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { trustedRequestUrl } from '@/lib/request-origin';
import { safeInternalPath } from '@/modules/identity/application/sign-in';

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  const redirect = (path: string) => {
    const response = NextResponse.redirect(trustedRequestUrl(request, path));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  if (
    !tokenHash ||
    tokenHash.length > 512 ||
    !/^[a-zA-Z0-9_-]+$/.test(tokenHash) ||
    !['email', 'signup', 'magiclink', 'recovery', 'invite'].includes(type ?? '')
  )
    return redirect('/sign-in?error=auth_callback_missing');

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'email' | 'signup' | 'magiclink' | 'recovery' | 'invite',
    });
    if (error) return redirect('/sign-in?error=auth_callback_failed');
  } catch {
    return redirect('/sign-in?error=auth_callback_failed');
  }

  // Recovery and first-time invitations must reach password setup, including on another device.
  if (type === 'recovery' || type === 'invite') return redirect('/reset-password');
  const fallback = type === 'signup' ? '/start' : '/app';
  const requested = request.nextUrl.searchParams.get('redirect_to');
  if (requested) {
    try {
      const origin = trustedRequestUrl(request, '/').origin;
      const destination = new URL(requested, origin);
      if (destination.origin === origin) {
        const path =
          destination.pathname === '/auth/callback'
            ? safeInternalPath(destination.searchParams.get('next'), fallback)
            : safeInternalPath(destination.pathname + destination.search, fallback);
        if (path !== '/' && !path.startsWith('/auth/')) return redirect(path);
      }
    } catch {
      /* Use the product destination for malformed redirects. */
    }
  }
  return redirect(fallback);
}
