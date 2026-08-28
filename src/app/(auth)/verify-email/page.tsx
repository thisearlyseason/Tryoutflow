type VerifyEmailPageProps = {
  searchParams: Promise<{ confirmed?: string; sent?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const parameters = await searchParams;
  const status =
    parameters.confirmed === '1'
      ? 'Your email is verified. You can continue to your organization.'
      : parameters.sent === '1'
        ? 'If that email belongs to an account, we sent a verification link.'
        : 'Enter your email to receive another verification link.';

  return (
    <main className="auth-page">
      <section aria-labelledby="verify-email-heading" className="auth-card">
        <p className="eyebrow">TryoutFlow</p>
        <h1 id="verify-email-heading">Verify your email</h1>
        <p role="status">{status}</p>
        <form action="/auth/verification" method="post">
          <label htmlFor="email">Email</label>
          <input autoComplete="email" id="email" name="email" required type="email" />
          <button type="submit">Send verification link</button>
        </form>
      </section>
    </main>
  );
}
