import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getTrustedSignInRequestContext } from '../../../modules/identity/application/password-sign-in-rate-limiter';
import { signInWithPassword } from '../../../modules/identity/application/sign-in';

type SignInPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

const messages: Record<string, string> = {
  abuse_protection_unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
  auth_callback_failed: 'That sign-in link has expired or was already used. Please sign in again.',
  auth_callback_missing: 'Your sign-in link is incomplete. Request a new one and try again.',
  invalid_credentials: 'We could not verify that email and password. Please try again.',
  rate_limited: 'Too many sign-in attempts. Please wait a few minutes before trying again.',
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const parameters = await searchParams;
  const message = parameters.error ? messages[parameters.error] : undefined;

  async function submit(formData: FormData) {
    'use server';

    const result = await signInWithPassword(
      {
        email: formData.get('email'),
        password: formData.get('password'),
        next: parameters.next,
      },
      {
        requestContext: getTrustedSignInRequestContext(await headers()),
      },
    );

    if (!result.ok) {
      redirect(`/sign-in?error=${result.error}`);
    }

    redirect(result.value.redirectTo);
  }

  return (
    <main className="auth-page">
      <section aria-labelledby="sign-in-heading" className="auth-card">
        <p className="eyebrow">TryoutFlow</p>
        <h1 id="sign-in-heading">Sign in to your organization</h1>
        <p>Use the email and password connected to your coaching account.</p>
        {message ? <p role="alert">{message}</p> : null}
        <form action={submit}>
          <label htmlFor="email">Email</label>
          <input
            className="min-h-11 px-3"
            autoComplete="email"
            id="email"
            name="email"
            required
            type="email"
          />
          <label htmlFor="password">Password</label>
          <input
            autoComplete="current-password"
            className="min-h-11 px-3"
            id="password"
            minLength={1}
            name="password"
            required
            type="password"
          />
          <button className="min-h-11 px-4" type="submit">
            Sign in
          </button>
        </form>
        <p>
          <a className="inline-flex min-h-11 items-center" href="/forgot-password">
            Forgot your password?
          </a>
        </p>
        <p>
          <a className="inline-flex min-h-11 items-center" href="/verify-email">
            Need a new verification link?
          </a>
        </p>
      </section>
    </main>
  );
}
