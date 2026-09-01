import { NextResponse, type NextRequest } from 'next/server';

import { trustedRequestUrl } from '../../../../lib/request-origin';
import { signOut } from '../../../../modules/identity/application/sign-out';

export async function POST(request: NextRequest) {
  const result = await signOut();
  const redirectPath = result.ok ? result.value.redirectTo : '/sign-in?error=sign_out_failed';

  return NextResponse.redirect(trustedRequestUrl(request, redirectPath));
}
