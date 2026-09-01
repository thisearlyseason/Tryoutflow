import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';
import { AuthShell } from '../../../components/layout/auth-shell';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const parameters = await searchParams;

  return (
    <AuthShell
      description="Enter your coaching account email and we’ll send secure reset instructions."
      eyebrow="Account recovery"
      footer={<a href="/sign-in">Return to sign in</a>}
      title="Reset your password"
    >
      {parameters.error ? (
        <p className="auth-alert" role="alert">
          Password recovery is temporarily unavailable. Please try again later.
        </p>
      ) : parameters.sent === '1' ? (
        <p className="auth-status" role="status">
          If that email belongs to an account, we sent password reset instructions.
        </p>
      ) : null}
      <form action="/auth/recovery" method="post">
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
        <BotChallenge action="recovery" />
        <Button className="mt-2 w-full" type="submit">
          Send reset instructions
        </Button>
      </form>
    </AuthShell>
  );
}
