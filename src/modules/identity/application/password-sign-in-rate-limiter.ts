import {
  getDefaultAuthAbuseProtection,
  getTrustedAuthRequestContext,
  type AuthAbuseProtection,
  type AuthRequestContext,
} from './database-auth-abuse-protection';

export type SignInRequestContext = AuthRequestContext;

export type PasswordSignInAttempt = {
  email: string;
  botVerificationToken: string;
  requestContext?: SignInRequestContext;
};

export type PasswordSignInAbuseProtection = {
  check(attempt: PasswordSignInAttempt): Promise<
    | { allowed: true }
    | {
        allowed: false;
        reason: 'rate_limited' | 'bot_verification_required' | 'abuse_protection_unavailable';
      }
  >;
};

export function getTrustedSignInRequestContext(headers: Headers): SignInRequestContext {
  return getTrustedAuthRequestContext(headers);
}

export function getDefaultPasswordSignInAbuseProtection(
  environment: Record<string, string | undefined> = process.env,
): PasswordSignInAbuseProtection {
  const protection: AuthAbuseProtection = getDefaultAuthAbuseProtection(environment);
  return {
    check(attempt) {
      return protection.check({
        scope: 'auth_sign_in',
        action: 'sign_in',
        subject: attempt.email,
        token: attempt.botVerificationToken,
        requestContext: attempt.requestContext,
      });
    },
  };
}
