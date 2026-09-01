import { redirect } from 'next/navigation';

import { acceptInvitation } from '../../../../modules/organizations/application/accept-invitation';
import { createServerSupabaseClient } from '../../../../infrastructure/supabase/server';
import { parseUserId } from '../../../../lib/ids';
import { AuthShell } from '../../../../components/layout/auth-shell';
import { Button } from '../../../../components/ui/button';
import { LinkButton } from '../../../../components/ui/link-button';

type InvitePageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function InvitePage({ params, searchParams }: InvitePageProps) {
  const [{ token }, parameters] = await Promise.all([params, searchParams]);
  const invitationFailed = parameters.error === 'invalid_or_expired' || token.length < 16;

  if (invitationFailed) {
    return (
      <AuthShell
        description="Invitations expire to protect your organization’s athlete and staff records."
        eyebrow="Invitation closed"
        footer={<a href="/sign-in">Return to sign in</a>}
        title="This invitation is no longer valid"
      >
        <p className="auth-alert" role="alert">
          Ask an administrator to send a new invitation if you still need access.
        </p>
      </AuthShell>
    );
  }

  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user?.email) {
    return (
      <AuthShell
        description="Sign in with the email address that received this invitation to confirm access."
        eyebrow="Team invitation"
        title="Your invitation is ready"
      >
        <LinkButton href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>
          Continue to sign in
        </LinkButton>
      </AuthShell>
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
    <AuthShell
      description="Confirm access to join your organization. This link can only be used by the invited email address."
      eyebrow="Team invitation"
      title="Your invitation is ready"
    >
      <form action={accept}>
        <Button className="w-full" type="submit">
          Accept invitation
        </Button>
      </form>
    </AuthShell>
  );
}
