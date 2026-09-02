import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';
import { AuthShell } from '../../../components/layout/auth-shell';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';

type SignInPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

const messages: Record<string, string> = {
  abuse_protection_unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  auth_callback_failed: 'That sign-in link has expired or was already used. Please sign in again.',
  auth_callback_missing: 'Your sign-in link is incomplete. Request a new one and try again.',
  bot_verification_required: 'Complete the bot-protection challenge and try again.',
  invalid_input: 'Check the sign-in form and try again.',
  invalid_credentials: 'We could not verify that email and password. Please try again.',
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
          <a href="/sign-up">New to TryoutFlow? Create an organization account</a>
          <a href="/forgot-password">Forgot your password?</a>
          <a href="/verify-email">Need a new verification link?</a>
        </nav>
      }
      title="Sign in to your account"
    >
      {message ? (
        <p className="auth-alert" role="alert">
          {message}
        </p>
      ) : null}
      <form action="/auth/sign-in" method="post">
        {parameters.next ? <input name="next" type="hidden" value={parameters.next} /> : null}
        <FormField htmlFor="email" label="Email" required>
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              autoComplete="email"
              id="email"
              name="email"
              required
              type="email"
            />
          )}
        </FormField>
        <FormField htmlFor="password" label="Password" required>
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              autoComplete="current-password"
              id="password"
              minLength={1}
              name="password"
              required
              type="password"
            />
          )}
        </FormField>
        <BotChallenge action="sign_in" />
        <Button className="mt-2 w-full" type="submit">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
