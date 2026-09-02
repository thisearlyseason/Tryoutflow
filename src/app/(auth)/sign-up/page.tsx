import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';
import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { AuthShell } from '../../../components/layout/auth-shell';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';

type SignUpPageProps = { searchParams: Promise<{ error?: string }> };

const messages: Record<string, string> = {
  invalid_input: 'Check the email and matching password fields, then try again.',
  rate_limited: 'Too many account requests. Please wait a few minutes and try again.',
  unavailable: 'Account creation is temporarily unavailable. Please try again later.',
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const parameters = await searchParams;
  return (
    <AuthShell
      description="Use your own email. After verification, you’ll create your organization and workspace address."
      eyebrow="New organization"
      footer={<a href="/sign-in">Already have an account? Sign in</a>}
      title="Create your organization account"
    >
      {parameters.error ? (
        <p className="auth-alert" role="alert">
          {messages[parameters.error] ?? messages.unavailable}
        </p>
      ) : null}
      <form action="/auth/sign-up" method="post">
        <FormField htmlFor="email" label="Email" required>
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              autoComplete="email"
              id="email"
              name="email"
              placeholder={FIELD_EXAMPLES.guardianEmail}
              required
              type="email"
            />
          )}
        </FormField>
        <FormField
          description="Use 12–128 characters."
          htmlFor="password"
          label="Password"
          required
        >
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              autoComplete="new-password"
              id="password"
              maxLength={128}
              minLength={12}
              name="password"
              required
              type="password"
            />
          )}
        </FormField>
        <FormField htmlFor="confirmPassword" label="Confirm password" required>
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              autoComplete="new-password"
              id="confirmPassword"
              maxLength={128}
              minLength={12}
              name="confirmPassword"
              required
              type="password"
            />
          )}
        </FormField>
        <BotChallenge action="sign_up" />
        <Button className="mt-2 w-full" type="submit">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
