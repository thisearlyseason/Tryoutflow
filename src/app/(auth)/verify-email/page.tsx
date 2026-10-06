import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';
import { AuthShell } from '../../../components/layout/auth-shell';

import { EmailVerificationForm } from '../../../modules/identity/ui/email-verification-form';

type VerifyEmailPageProps = {
  searchParams: Promise<{
    confirmed?: string;
    error?: string;
    sent?: string;
    signup?: string;
    purpose?: string;
  }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const parameters = await searchParams;
  const participant = parameters.purpose === 'participant';
  const status = parameters.error
    ? 'Verification email is temporarily unavailable. Please try again later.'
    : parameters.signup === '1'
      ? participant
        ? 'Check your inbox and verify your email to open your athlete and family portal.'
        : 'Check your inbox and verify your email before continuing to organization setup.'
      : parameters.confirmed === '1'
        ? 'Your email is verified. You can continue to your organization.'
        : parameters.sent === '1'
          ? 'If that email belongs to an account, we sent a verification link.'
          : 'Enter your email to receive another verification link.';

  return (
    <AuthShell
      description="Keep your organization secure by confirming the email connected to your account."
      eyebrow="Account security"
      footer={
        <a href={participant ? '/sign-in?next=/participant' : '/sign-in'}>Return to sign in</a>
      }
      title="Verify your email"
    >
      <p
        className={parameters.error ? 'auth-alert' : 'auth-status'}
        role={parameters.error ? 'alert' : 'status'}
      >
        {status}
      </p>
      {parameters.signup === '1' ? (
        <p className="auth-description">
          {participant
            ? 'The verification link will open your athlete and family portal.'
            : 'We’ll take you to organization setup automatically when you open the verification link.'}
        </p>
      ) : (
        <EmailVerificationForm
          participant={participant}
          botChallenge={<BotChallenge action="verification" />}
        />
      )}
    </AuthShell>
  );
}
