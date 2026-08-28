import { redirect } from 'next/navigation';

import { resetPassword } from '../../../modules/identity/application/reset-password';

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const parameters = await searchParams;

  async function submit(formData: FormData) {
    'use server';

    const result = await resetPassword({ password: formData.get('password') });

    if (!result.ok) {
      redirect('/reset-password?error=reset_failed');
    }

    redirect('/sign-in');
  }

  return (
    <main className="auth-page">
      <section aria-labelledby="reset-password-heading" className="auth-card">
        <p className="eyebrow">TryoutFlow</p>
        <h1 id="reset-password-heading">Choose a new password</h1>
        {parameters.error ? (
          <p role="alert">We could not reset your password. Please try again.</p>
        ) : null}
        <form action={submit}>
          <label htmlFor="password">New password</label>
          <input
            autoComplete="new-password"
            id="password"
            minLength={12}
            name="password"
            required
            type="password"
          />
          <button type="submit">Save new password</button>
        </form>
      </section>
    </main>
  );
}
