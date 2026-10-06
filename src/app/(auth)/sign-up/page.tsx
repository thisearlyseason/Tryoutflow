import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { AuthShell } from '../../../components/layout/auth-shell';
import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';
import { SignUpForm } from '../../../modules/identity/ui/sign-up-form';

type SignUpPageProps = { searchParams: Promise<{ error?: string; purpose?: string }> };

const messages: Record<string, string> = {
  invalid_input: 'Check the email and matching password fields, then try again.',
  rate_limited: 'Too many account requests. Please wait a few minutes and try again.',
  unavailable: 'Account creation is temporarily unavailable. Please try again later.',
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const parameters = await searchParams;
  const participant = parameters.purpose === 'participant';
  return (
    <AuthShell
      description={
        participant
          ? 'Accounts are for adults aged 18 or older. Create your athlete or family account, verify your email, then ask your organizer to link the appropriate athlete profile.'
          : 'Accounts are for adults aged 18 or older. Use your own email. After verification, you’ll create your organization and workspace address.'
      }
      eyebrow={participant ? 'Athlete and family access' : 'New organization'}
      footer={
        <>
          <a href={participant ? '/sign-in?next=/participant' : '/sign-in'}>
            Already have an account? Sign in
          </a>
          <a href={participant ? '/sign-up' : '/sign-up?purpose=participant'}>
            {participant
              ? 'Organizing tryouts? Create an organization account'
              : 'Athlete or family? Create a participant account'}
          </a>
        </>
      }
      title={participant ? 'Create your participant account' : 'Create your organization account'}
    >
      {parameters.error ? (
        <p className="auth-alert" role="alert">
          {messages[parameters.error] ?? messages.unavailable}
        </p>
      ) : null}
      <SignUpForm
        participant={participant}
        botChallenge={<BotChallenge action="sign_up" />}
        emailPlaceholder={FIELD_EXAMPLES.guardianEmail}
      />
    </AuthShell>
  );
}
