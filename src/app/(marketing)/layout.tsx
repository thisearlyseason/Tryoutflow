import type { ReactNode } from 'react';
import { cookies } from 'next/headers';

import { MarketingShell } from '../../components/layout/marketing-shell';
import {
  createServerSupabaseClient,
  hasSupabaseSessionCookie,
} from '../../infrastructure/supabase/server';

export default async function MarketingLayout({ children }: Readonly<{ children: ReactNode }>) {
  const cookieStore = await cookies();
  let authenticated = false;
  if (hasSupabaseSessionCookie(cookieStore.getAll())) {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.auth.getUser();
    authenticated = !error && Boolean(data.user);
  }

  return <MarketingShell authenticated={authenticated}>{children}</MarketingShell>;
}
