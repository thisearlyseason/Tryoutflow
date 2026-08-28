import { NextResponse, type NextRequest } from 'next/server';

import { requestEmailVerification } from '../../../../modules/identity/application/request-email-verification';

function callbackUrl(request: NextRequest) {
  const url = new URL('/auth/callback', request.url);
  url.searchParams.set('next', '/verify-email?confirmed=1');
  return url.toString();
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  await requestEmailVerification({
    email: formData.get('email'),
    redirectTo: callbackUrl(request),
  });

  return NextResponse.redirect(new URL('/verify-email?sent=1', request.url));
}
