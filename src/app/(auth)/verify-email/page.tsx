import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';
import { AuthShell } from '../../../components/layout/auth-shell';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';

type VerifyEmailPageProps = {
  searchParams: Promise<{ confirmed?: string; error?: string; sent?: string; signup?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const parameters = await searchParams;
  const status = parameters.error
    ? 'Verification email is temporarily unavailable. Please try again later.'
    : parameters.signup === '1'
      ? 'Check your inbox and verify your email before continuing to organization setup.'
      : parameters.confirmed === '1'
        ? 'Your email is verified. You can continue to your organization.'
        : parameters.sent === '1'
          ? 'If that email belongs to an account, we sent a verification link.'
          : 'Enter your email to receive another verification link.';

  return (
    <AuthShell
      description="Keep your organization secure by confirming the email connected to your account."
      eyebrow="Account security"
      footer={<a href="/sign-in">Return to sign in</a>}
      title="Verify your email"
    >
      <p
        className={parameters.error ? 'auth-alert' : 'auth-status'}
        role={parameters.error ? 'alert' : 'status'}
      >
        {status}
      </p>
      <form action="/auth/verification" method="post">
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
        <BotChallenge action="verification" />
        <Button className="mt-2 w-full" type="submit">
          Send verification link
        </Button>
      </form>
    </AuthShell>
  );
}
