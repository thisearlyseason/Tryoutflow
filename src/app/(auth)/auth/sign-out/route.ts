import { NextResponse, type NextRequest } from 'next/server';

import { trustedRequestUrl } from '../../../../lib/request-origin';
import { signOut } from '../../../../modules/identity/application/sign-out';

export async function POST(request: NextRequest) {
  const result = await signOut();
  const redirectPath = result.ok ? result.value.redirectTo : '/sign-in?error=sign_out_failed';

  const destination = trustedRequestUrl(request, redirectPath);
  // Preserve the family entry purpose without accepting a redirect URL from the request.
  if (request.nextUrl.searchParams.get('returnTo') === 'participant') {
    destination.searchParams.set('next', '/participant');
  }
  return NextResponse.redirect(destination, 303);
}
