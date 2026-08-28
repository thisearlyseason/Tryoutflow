import { NextResponse, type NextRequest } from 'next/server';

import { requestPasswordRecovery } from '../../../../modules/identity/application/request-password-recovery';

function callbackUrl(request: NextRequest) {
  const url = new URL('/auth/callback', request.url);
  url.searchParams.set('next', '/reset-password');
  return url.toString();
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  await requestPasswordRecovery({
    email: formData.get('email'),
    redirectTo: callbackUrl(request),
  });

  return NextResponse.redirect(new URL('/forgot-password?sent=1', request.url));
}
