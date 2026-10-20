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
    .order('organization_id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membership.error || !membership.data) redirect('/start');

  const organization = await client
    .from('organizations')
    .select('slug')
    .eq('id', membership.data.organization_id)
    .maybeSingle();
  if (organization.error || !organization.data) redirect('/start');
  redirect(`/app/${organization.data.slug}/home`);
}
