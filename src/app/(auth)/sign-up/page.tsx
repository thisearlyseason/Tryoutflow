import { BotChallenge } from '../../../modules/identity/ui/bot-challenge';

type SignUpPageProps = { searchParams: Promise<{ error?: string }> };

const messages: Record<string, string> = {
  invalid_input: 'Check the email and matching password fields, then try again.',
  rate_limited: 'Too many account requests. Please wait a few minutes and try again.',
  unavailable: 'Account creation is temporarily unavailable. Please try again later.',
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const parameters = await searchParams;
  return (
    <main className="auth-page">
      <section aria-labelledby="sign-up-heading" className="auth-card">
        <p className="eyebrow">TryoutFlow</p>
        <h1 id="sign-up-heading">Create your organization account</h1>
        <p>Use your own email. You’ll verify it before creating your organization.</p>
        {parameters.error ? (
          <p role="alert">{messages[parameters.error] ?? messages.unavailable}</p>
        ) : null}
        <form action="/auth/sign-up" method="post">
          <label htmlFor="email">Email</label>
          <input autoComplete="email" id="email" name="email" required type="email" />
          <label htmlFor="password">Password</label>
          <input
            autoComplete="new-password"
            id="password"
            minLength={12}
            maxLength={128}
            name="password"
            required
            type="password"
          />
          <label htmlFor="confirmPassword">Confirm password</label>
          <input
            autoComplete="new-password"
            id="confirmPassword"
            minLength={12}
            maxLength={128}
            name="confirmPassword"
            required
            type="password"
          />
          <BotChallenge action="sign_up" />
          <button type="submit">Create account</button>
        </form>
        <p>
          <a href="/sign-in">Already have an account? Sign in</a>
        </p>
      </section>
    </main>
  );
}
