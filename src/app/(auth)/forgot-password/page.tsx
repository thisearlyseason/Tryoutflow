import { AuthEmailRequestForm } from '../../../modules/identity/ui/auth-email-request-form';
import { getBotChallengeConfiguration } from '../../../modules/identity/ui/bot-challenge';
import { AuthShell } from '../../../components/layout/auth-shell';

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
      <AuthEmailRequestForm action="recovery" {...getBotChallengeConfiguration()} />
    </AuthShell>
  );
}
