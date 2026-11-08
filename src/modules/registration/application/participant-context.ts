import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';

/** Request-scoped verification: family access does not require organization membership. */
export const requireParticipantContext = cache(async () => {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) redirect('/sign-in?next=/participant');
  return { client, user };
});
