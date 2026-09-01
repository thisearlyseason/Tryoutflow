import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const parameters = await searchParams;

  return (
    <main className="auth-page">
      <section aria-labelledby="forgot-password-heading" className="auth-card">
        <p className="eyebrow">TryoutFlow</p>
        <h1 id="forgot-password-heading">Reset your password</h1>
        {parameters.error ? (
          <p role="alert">Password recovery is temporarily unavailable. Please try again later.</p>
        ) : parameters.sent === '1' ? (
          <p role="status">
            If that email belongs to an account, we sent password reset instructions.
          </p>
        ) : (
          <p>Enter your email and we’ll send password reset instructions.</p>
        )}
        <form action="/auth/recovery" method="post">
          <label htmlFor="email">Email</label>
          <input autoComplete="email" id="email" name="email" required type="email" />
          <BotChallenge action="recovery" />
          <button type="submit">Send reset instructions</button>
        </form>
      </section>
    </main>
  );
}
