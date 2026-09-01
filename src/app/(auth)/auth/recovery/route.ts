import { NextResponse, type NextRequest } from 'next/server';

import { captureOperationalError } from '../../../../infrastructure/observability/server-observability';
import { trustedRequestUrl } from '../../../../lib/request-origin';
import {
  getDefaultAuthAbuseProtection,
  type AuthAbuseProtection,
} from '../../../../modules/identity/application/database-auth-abuse-protection';
import { guardAuthFormRequest } from '../../../../modules/identity/application/guard-auth-form-request';
import { requestPasswordRecovery } from '../../../../modules/identity/application/request-password-recovery';
import { AppError } from '../../../../modules/observability/domain/app-error';

function callbackUrl(request: NextRequest) {
  const url = trustedRequestUrl(request, '/auth/callback');
  url.searchParams.set('next', '/reset-password');
  return url.toString();
}

export async function handlePasswordRecovery(
  request: NextRequest,
  dependencies: {
    abuseProtection?: AuthAbuseProtection;
    command?: typeof requestPasswordRecovery;
  } = {},
) {
  const guarded = await guardAuthFormRequest(request, {
    allowedFields: ['email', 'cf-turnstile-response'],
  });
  if (!guarded.ok)
    return NextResponse.redirect(
      trustedRequestUrl(request, '/forgot-password?error=unavailable'),
      303,
    );
  const email = guarded.fields.get('email') ?? '';
  try {
    const decision = await (dependencies.abuseProtection ?? getDefaultAuthAbuseProtection()).check({
      scope: 'auth_recovery',
      action: 'recovery',
      subject: email,
      token: guarded.fields.get('cf-turnstile-response') ?? '',
      requestContext: guarded.requestContext,
    });
    if (!decision.allowed) {
      if (decision.reason === 'abuse_protection_unavailable')
        captureOperationalError(new AppError('integration_unavailable'), {
          operation: 'auth.recovery',
        });
      return NextResponse.redirect(
        trustedRequestUrl(request, '/forgot-password?error=unavailable'),
        303,
      );
    }
    const outcome = await (dependencies.command ?? requestPasswordRecovery)({
      email,
      redirectTo: callbackUrl(request),
    });
    if (!outcome.ok)
      captureOperationalError(new AppError('integration_unavailable'), {
        operation: 'auth.recovery',
      });
  } catch (error) {
    captureOperationalError(error, { operation: 'auth.recovery' });
    return NextResponse.redirect(
      trustedRequestUrl(request, '/forgot-password?error=unavailable'),
      303,
    );
  }
  return NextResponse.redirect(trustedRequestUrl(request, '/forgot-password?sent=1'), 303);
}

export async function POST(request: NextRequest) {
  return handlePasswordRecovery(request);
}
