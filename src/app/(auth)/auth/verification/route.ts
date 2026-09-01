import { NextResponse, type NextRequest } from 'next/server';

import { captureOperationalError } from '../../../../infrastructure/observability/server-observability';
import { trustedRequestUrl } from '../../../../lib/request-origin';
import {
  getDefaultAuthAbuseProtection,
  type AuthAbuseProtection,
} from '../../../../modules/identity/application/database-auth-abuse-protection';
import { guardAuthFormRequest } from '../../../../modules/identity/application/guard-auth-form-request';
import { requestEmailVerification } from '../../../../modules/identity/application/request-email-verification';
import { AppError } from '../../../../modules/observability/domain/app-error';

function callbackUrl(request: NextRequest) {
  const url = trustedRequestUrl(request, '/auth/callback');
  url.searchParams.set('next', '/verify-email?confirmed=1');
  return url.toString();
}

export async function handleEmailVerification(
  request: NextRequest,
  dependencies: {
    abuseProtection?: AuthAbuseProtection;
    command?: typeof requestEmailVerification;
  } = {},
) {
  const guarded = await guardAuthFormRequest(request, {
    allowedFields: ['email', 'cf-turnstile-response'],
  });
  if (!guarded.ok)
    return NextResponse.redirect(
      trustedRequestUrl(request, '/verify-email?error=unavailable'),
      303,
    );
  const email = guarded.fields.get('email') ?? '';
  try {
    const decision = await (dependencies.abuseProtection ?? getDefaultAuthAbuseProtection()).check({
      scope: 'auth_verification',
      action: 'verification',
      subject: email,
      token: guarded.fields.get('cf-turnstile-response') ?? '',
      requestContext: guarded.requestContext,
    });
    if (!decision.allowed) {
      if (decision.reason === 'abuse_protection_unavailable')
        captureOperationalError(new AppError('integration_unavailable'), {
          operation: 'auth.verification',
        });
      return NextResponse.redirect(
        trustedRequestUrl(request, '/verify-email?error=unavailable'),
        303,
      );
    }
    const outcome = await (dependencies.command ?? requestEmailVerification)({
      email,
      redirectTo: callbackUrl(request),
    });
    if (!outcome.ok)
      captureOperationalError(new AppError('integration_unavailable'), {
        operation: 'auth.verification',
      });
  } catch (error) {
    captureOperationalError(error, { operation: 'auth.verification' });
    return NextResponse.redirect(
      trustedRequestUrl(request, '/verify-email?error=unavailable'),
      303,
    );
  }
  return NextResponse.redirect(trustedRequestUrl(request, '/verify-email?sent=1'), 303);
}

export async function POST(request: NextRequest) {
  return handleEmailVerification(request);
}
