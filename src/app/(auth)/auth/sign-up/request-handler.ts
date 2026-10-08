import { NextResponse, type NextRequest } from 'next/server';

import { captureOperationalError } from '../../../../infrastructure/observability/server-observability';
import { trustedRequestUrl } from '../../../../lib/request-origin';
import { createOwnerAccount } from '../../../../modules/identity/application/create-account';
import {
  getDefaultAuthAbuseProtection,
  type AuthAbuseProtection,
} from '../../../../modules/identity/application/database-auth-abuse-protection';
import { guardAuthFormRequest } from '../../../../modules/identity/application/guard-auth-form-request';
import { AppError } from '../../../../modules/observability/domain/app-error';

function verificationCallback(request: NextRequest, participant = false) {
  const callback = trustedRequestUrl(request, '/auth/callback');
  callback.searchParams.set('next', participant ? '/participant' : '/start');
  return callback.toString();
}

export async function handleSignUp(
  request: NextRequest,
  dependencies: {
    abuseProtection?: AuthAbuseProtection;
    createAccount?: typeof createOwnerAccount;
  } = {},
) {
  const guarded = await guardAuthFormRequest(request, {
    allowedFields: ['email', 'password', 'confirmPassword', 'cf-turnstile-response', 'purpose'],
  });
  if (!guarded.ok)
    return NextResponse.redirect(trustedRequestUrl(request, '/sign-up?error=invalid_input'), 303);
  const participant = guarded.fields.get('purpose') === 'participant';
  const purposeSuffix = participant ? '&purpose=participant' : '';
  const email = guarded.fields.get('email') ?? '';
  const password = guarded.fields.get('password') ?? '';
  const confirmPassword = guarded.fields.get('confirmPassword') ?? '';
  const token = guarded.fields.get('cf-turnstile-response') ?? '';
  if (password !== confirmPassword)
    return NextResponse.redirect(
      trustedRequestUrl(request, `/sign-up?error=invalid_input${purposeSuffix}`),
      303,
    );
  try {
    const protection = dependencies.abuseProtection ?? getDefaultAuthAbuseProtection();
    const decision = await protection.check({
      scope: 'auth_sign_up',
      action: 'sign_up',
      subject: email,
      token,
      requestContext: guarded.requestContext,
    });
    if (!decision.allowed) {
      if (decision.reason === 'abuse_protection_unavailable')
        captureOperationalError(new AppError('integration_unavailable'), {
          operation: 'auth.sign_up',
        });
      const error = decision.reason === 'rate_limited' ? 'rate_limited' : 'unavailable';
      return NextResponse.redirect(
        trustedRequestUrl(request, `/sign-up?error=${error}${purposeSuffix}`),
        303,
      );
    }
    const result = await (dependencies.createAccount ?? createOwnerAccount)({
      email,
      password,
      emailRedirectTo: verificationCallback(request, participant),
    });
    if (!result.ok) {
      if (result.error === 'account_creation_unavailable')
        captureOperationalError(new AppError('integration_unavailable'), {
          operation: 'auth.sign_up',
        });
      const error = result.error === 'invalid_input' ? 'invalid_input' : 'unavailable';
      return NextResponse.redirect(
        trustedRequestUrl(request, `/sign-up?error=${error}${purposeSuffix}`),
        303,
      );
    }
    return NextResponse.redirect(
      trustedRequestUrl(request, '/verify-email?signup=1' + purposeSuffix),
      303,
    );
  } catch {
    captureOperationalError(new AppError('integration_unavailable'), {
      operation: 'auth.sign_up',
    });
    return NextResponse.redirect(
      trustedRequestUrl(request, '/sign-up?error=unavailable' + purposeSuffix),
      303,
    );
  }
}

export async function POST(request: NextRequest) {
  return handleSignUp(request);
}
