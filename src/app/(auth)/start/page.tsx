import { redirect } from 'next/navigation';
import { PrivateSessionBoundary } from '@/modules/identity/ui/private-session-boundary';
import { Suspense } from 'react';
import { AuthShell } from '../../../components/layout/auth-shell';
import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { StartErrorMessage } from '../../../modules/organizations/ui/start-error-message';
import { StartOrganizationForm } from '../../../modules/organizations/ui/start-organization-form';
import { startOrganizationAction } from '../../../modules/organizations/application/start-organization-action';

export default async function StartPage({
  searchParams,
}: { searchParams?: Promise<{ plan?: string }> } = {}) {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect('/sign-in?next=%2Fstart');
  const query = (await searchParams) ?? {};
  return (
    <PrivateSessionBoundary userId={user.id}>
      <AuthShell
        description="Start with the team, club, or academy that runs your tryouts. You will be its first owner."
        eyebrow="Organization setup"
        title="Set up your organization"
      >
        <Suspense fallback={null}>
          <StartErrorMessage />
        </Suspense>
        <StartOrganizationForm
          action={startOrganizationAction}
          plan={query.plan === 'pro' ? 'pro' : undefined}
        />
      </AuthShell>
    </PrivateSessionBoundary>
  );
}

export const metadata = { title: 'Set up your organization | TryoutFlow' };
