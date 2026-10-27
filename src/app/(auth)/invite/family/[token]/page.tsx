import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { UsersRound, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { acceptFamilyInvitation } from '@/modules/talent/application/family-invitations';
import { familyInvitationPath } from '@/lib/family-invitation-path';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Family invitation | TryoutFlow',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function FamilyInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const path = familyInvitationPath(`/invite/family/${token}`);
  if (!path)
    return (
      <AuthShell
        title="Invitation unavailable"
        eyebrow="Family portal"
        description="Ask your coach for a new family invitation link."
        children={null}
      />
    );
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  const next = encodeURIComponent(path);
  async function accept() {
    'use server';
    const result = await acceptFamilyInvitation(token);
    if (!result.ok) redirect(`${path}?error=unavailable`);
    redirect('/participant');
  }
  return (
    <AuthShell
      title="Your athlete. Your front-row seat."
      eyebrow="Family invitation"
      description="Your coach has invited you to the family portal. Accept with the verified email they invited."
      proofItems={[
        'One athlete, securely connected',
        'Approved feedback and event updates',
        'Family access only — no coach workspace',
      ]}
      footer={<a href={`/sign-in?next=${next}`}>Sign in with a different account</a>}
    >
      <div className="family-invite-welcome">
        <UsersRound size={32} aria-hidden="true" />
        <p>Your connection to tryout day starts here.</p>
      </div>
      {query.error ? (
        <p role="alert" className="auth-alert">
          This invitation could not be accepted. Use the invited, verified email, or ask your coach
          to check your invitation and existing family access. Existing access has not changed.
        </p>
      ) : null}
      {user ? (
        <form action={accept}>
          <Button type="submit">Accept family invitation</Button>
        </form>
      ) : (
        <div className="family-invite-actions">
          <a className="button-primary" href={`/sign-in?next=${next}`}>
            Sign in and accept
          </a>
          <a className="button-secondary" href={`/sign-up?purpose=participant&next=${next}`}>
            Create a family account
          </a>
        </div>
      )}
      <p className="family-access-note">
        <ShieldCheck size={18} aria-hidden="true" />
        Only information approved for your linked athlete will be shared.
      </p>
    </AuthShell>
  );
}
