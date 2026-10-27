import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import {
  OrganizationEntry,
  OrganizationEntryFrame,
} from '@/modules/organizations/ui/organization-entry';

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
  // Organization setup is an explicit organizer choice, never the default for families.
  if (!membership.data?.length) redirect('/participant');

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
  return <OrganizationEntry organizations={organizations.data} />;
}

function WorkspaceLoadError() {
  return (
    <OrganizationEntryFrame
      title="We could not load your organizations"
      description="Your memberships have not changed. Try loading them again."
    >
      <Link className="button-primary" href="/app" prefetch={false}>
        Try again
      </Link>
    </OrganizationEntryFrame>
  );
}
