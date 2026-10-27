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
  invalid_input: 'Enter a valid email address and your password, then try again.',
  invalid_credentials: 'We could not verify that email and password. Please try again.',
  email_not_confirmed:
    'Please verify your email first. Use “Need a new verification link?” below if you need another email.',
  rate_limited: 'Too many sign-in attempts. Please wait a few minutes before trying again.',
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const parameters = await searchParams;
  const participant = parameters.next === '/participant';
  const message = parameters.error
    ? ((Object.hasOwn(messages, parameters.error) ? messages[parameters.error] : undefined) ??
      'Sign-in could not be completed. Check your email and password, then try again.')
    : undefined;

  return (
    <AuthShell
      sportsBackground
      proofItems={
        participant
          ? [
              'Your linked athletes',
              'Approved feedback and event updates',
              'Schedules and registration',
            ]
          : undefined
      }
      description={
        parameters.next === '/participant'
          ? 'Sign in to your athlete and family portal. New to TryoutFlow? Create an athlete or family account first.'
          : 'Sign in to return to your organization. New to TryoutFlow? Create an organization account first.'
      }
      eyebrow={participant ? 'Family portal' : 'Coach & staff sign-in'}
      footer={
        <nav aria-label="Account help">
          {participant ? <a href="/sign-in">Coach & staff sign-in</a> : null}
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
      title={participant ? 'Athlete and family portal' : 'Sign in to your account'}
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
      <nav aria-label="Account access" className="flex flex-wrap gap-3">
        {!participant ? (
          <a className="auth-create-account" href="/participant">
            Family portal
          </a>
        ) : null}
        <a
          className="auth-create-account"
          href={participant ? '/sign-up?purpose=participant' : '/sign-up'}
        >
          New here? Create an account
        </a>
      </nav>
      <SignInForm next={parameters.next} {...getBotChallengeConfiguration()} />
    </AuthShell>
  );
}
