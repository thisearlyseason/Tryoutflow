import { getBotChallengeConfiguration } from '../../../modules/identity/ui/bot-challenge';
import { AuthShell } from '../../../components/layout/auth-shell';
import { SignInForm } from '../../../modules/identity/ui/sign-in-form';

type SignInPageProps = {
  searchParams: Promise<{ error?: string; next?: string; password_updated?: string }>;
};

const messages: Record<string, string> = {
  abuse_protection_unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  auth_callback_failed: 'That sign-in link has expired or was already used. Please sign in again.',
  auth_callback_missing: 'Your sign-in link is incomplete. Request a new one and try again.',
  bot_verification_required: 'Complete the bot-protection challenge and try again.',
  invalid_input: 'Check the sign-in form and try again.',
  invalid_credentials: 'We could not verify that email and password. Please try again.',
  email_not_confirmed:
    'Please verify your email first. Use “Need a new verification link?” below if you need another email.',
  rate_limited: 'Too many sign-in attempts. Please wait a few minutes before trying again.',
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const parameters = await searchParams;
  const message = parameters.error ? messages[parameters.error] : undefined;

  return (
    <AuthShell
      description="Sign in to return to your organization. New to TryoutFlow? Create an organization account first."
      eyebrow="Welcome back"
      footer={
        <nav aria-label="Account help">
          <a
            href={parameters.next === '/participant' ? '/sign-up?purpose=participant' : '/sign-up'}
          >
            {parameters.next === '/participant'
              ? 'Create an athlete or family account'
              : 'New to TryoutFlow? Create an organization account'}
          </a>
          <a href="/forgot-password">Forgot your password?</a>
          <a
            href={
              parameters.next === '/participant'
                ? '/verify-email?purpose=participant'
                : '/verify-email'
            }
          >
            Need a new verification link?
          </a>
        </nav>
      }
      title="Sign in to your account"
    >
      {parameters.password_updated === '1' ? (
        <p className="auth-alert" role="status">
          Password saved. Sign in with the email address that received your recovery link.
        </p>
      ) : null}
      {message ? (
        <p className="auth-alert" role="alert">
          {message}
        </p>
      ) : null}
      <a
        className="auth-create-account"
        href={parameters.next === '/participant' ? '/sign-up?purpose=participant' : '/sign-up'}
      >
        New here? Create an account
      </a>
      <SignInForm next={parameters.next} {...getBotChallengeConfiguration()} />
    </AuthShell>
  );
}
