import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/infrastructure/supabase/server';

export default async function AppLandingPage() {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect('/sign-in');

  const membership = await client
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .order('organization_id', { ascending: true });
  if (membership.error) return <WorkspaceLoadError />;
  if (!membership.data?.length) redirect('/start');

  const organizations = await client
    .from('organizations')
    .select('id,name,slug')
    .in(
      'id',
      membership.data.map(({ organization_id }) => organization_id),
    );
  if (organizations.error || !organizations.data?.length) return <WorkspaceLoadError />;
  const onlyOrganization = organizations.data[0];
  if (organizations.data.length === 1 && onlyOrganization)
    redirect(`/app/${onlyOrganization.slug}/home`);
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6" id="main-content">
      <header>
        <p className="eyebrow">Welcome back</p>
        <h1>Choose your organization</h1>
        <p>Open the organization where you want to organize a tryout or score athletes.</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {organizations.data.map((organization) => (
          <li className="card" key={organization.id}>
            <h2>{organization.name}</h2>
            <Link
              className="button-primary"
              href={`/app/${organization.slug}/home`}
              prefetch={false}
            >
              Open {organization.name}
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/start">Create another organization</Link>
    </main>
  );
}

function WorkspaceLoadError() {
  return (
    <main className="mx-auto grid max-w-xl gap-4 p-6" id="main-content">
      <h1>We could not load your organizations</h1>
      <p>Your memberships have not changed. Try loading them again.</p>
      <Link className="button-primary" href="/app" prefetch={false}>
        Try again
      </Link>
    </main>
  );
}
