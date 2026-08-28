import Link from 'next/link';

type InvitePageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  const [{ token }, parameters] = await Promise.all([params, searchParams]);
  const invitationFailed = parameters.error === 'invalid_or_expired' || token.length < 16;

  if (invitationFailed) {
    return (
      <main className="auth-page">
        <section aria-labelledby="invite-error-heading" className="auth-card">
          <h1 id="invite-error-heading">This invitation is no longer valid</h1>
          <p>
            Invitations expire for your organization’s security. Ask an administrator to send a new
            invitation if you still need access.
          </p>
          <Link href="/sign-in">Return to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section aria-labelledby="invite-heading" className="auth-card">
        <h1 id="invite-heading">Your invitation is ready</h1>
        <p>Finish setting up your account from the invitation email to join your organization.</p>
        <Link href="/sign-in">Continue to sign in</Link>
      </section>
    </main>
  );
}
