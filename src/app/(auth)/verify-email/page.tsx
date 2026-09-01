import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';

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
    <main className="auth-page">
      <section aria-labelledby="verify-email-heading" className="auth-card">
        <p className="eyebrow">TryoutFlow</p>
        <h1 id="verify-email-heading">Verify your email</h1>
        <p role={parameters.error ? 'alert' : 'status'}>{status}</p>
        <form action="/auth/verification" method="post">
          <label htmlFor="email">Email</label>
          <input autoComplete="email" id="email" name="email" required type="email" />
          <BotChallenge action="verification" />
          <button type="submit">Send verification link</button>
        </form>
      </section>
    </main>
  );
}
