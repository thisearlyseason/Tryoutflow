import { NextResponse, type NextRequest } from 'next/server';

import { captureOperationalError } from '../../../../infrastructure/observability/server-observability';
import { trustedRequestUrl } from '../../../../lib/request-origin';
import type { AuthAbuseProtection } from '../../../../modules/identity/application/database-auth-abuse-protection';
import { guardAuthFormRequest } from '../../../../modules/identity/application/guard-auth-form-request';
import { signInWithPassword } from '../../../../modules/identity/application/sign-in';
import { AppError } from '../../../../modules/observability/domain/app-error';

export async function handleSignIn(
  request: NextRequest,
  dependencies: { abuseProtection?: AuthAbuseProtection } = {},
) {
  const guarded = await guardAuthFormRequest(request, {
    allowedFields: ['email', 'password', 'next', 'cf-turnstile-response'],
  });
  if (!guarded.ok)
    return NextResponse.redirect(trustedRequestUrl(request, '/sign-in?error=invalid_input'), 303);
  const result = await signInWithPassword(
    {
      email: guarded.fields.get('email'),
      password: guarded.fields.get('password'),
      next: guarded.fields.get('next') ?? undefined,
      botVerificationToken: guarded.fields.get('cf-turnstile-response'),
    },
    {
      requestContext: guarded.requestContext,
      ...(dependencies.abuseProtection
        ? {
            abuseProtection: {
              check: (attempt) =>
                dependencies.abuseProtection!.check({
                  scope: 'auth_sign_in',
                  action: 'sign_in',
                  subject: attempt.email,
                  token: attempt.botVerificationToken,
                  requestContext: attempt.requestContext,
                }),
            },
          }
        : {}),
    },
  );
  if (!result.ok) {
    if (result.error === 'abuse_protection_unavailable')
      captureOperationalError(new AppError('integration_unavailable'), {
        operation: 'auth.sign_in',
      });
    const error =
      result.error === 'bot_verification_required' ||
      result.error === 'abuse_protection_unavailable' ||
      result.error === 'rate_limited' ||
      result.error === 'invalid_credentials'
        ? result.error
        : 'invalid_input';
    return NextResponse.redirect(trustedRequestUrl(request, `/sign-in?error=${error}`), 303);
  }
  return NextResponse.redirect(trustedRequestUrl(request, result.value.redirectTo), 303);
}

export async function POST(request: NextRequest) {
  return handleSignIn(request);
}
