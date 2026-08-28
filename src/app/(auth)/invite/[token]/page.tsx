import Link from 'next/link';
import { redirect } from 'next/navigation';

import { acceptInvitation } from '../../../../modules/organizations/application/accept-invitation';
import { createServerSupabaseClient } from '../../../../infrastructure/supabase/server';
import { parseUserId } from '../../../../lib/ids';

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

  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user?.email) {
    return (
      <main className="auth-page">
        <section aria-labelledby="invite-heading" className="auth-card">
          <h1 id="invite-heading">Your invitation is ready</h1>
          <p>Sign in with the email address that received this invitation to confirm access.</p>
          <Link href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>
            Continue to sign in
          </Link>
        </section>
      </main>
    );
  }
  const invitationActor = { userId: parseUserId(user.id), email: user.email };

  async function accept() {
    'use server';
    const result = await acceptInvitation(token, invitationActor);
    if (!result.ok) redirect(`/invite/${token}?error=invalid_or_expired`);
    redirect(`/app/${result.value.organizationSlug}/home`);
  }

  return (
    <main className="auth-page">
      <section aria-labelledby="invite-heading" className="auth-card">
        <h1 id="invite-heading">Your invitation is ready</h1>
        <p>
          Confirm access to join your organization. This link can only be used by the invited email
          address.
        </p>
        <form action={accept}>
          <button type="submit">Accept invitation</button>
        </form>
      </section>
    </main>
  );
}
