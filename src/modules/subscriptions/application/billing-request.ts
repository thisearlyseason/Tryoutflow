import { nativeContext } from '@/modules/identity/native-context';
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import type { Database } from '@/infrastructure/supabase/database.types';
import { getClientEnvironment } from '@/lib/env';
export async function billingRequestContext(request: Request) {
  const authorization = request.headers.get('authorization');
  let client;
  if (authorization) {
    if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) throw new Error('unauthorized');
    const env = getClientEnvironment();
    client = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      },
    );
  } else {
    if (
      request.method !== 'GET' &&
      request.headers.get('origin') !== new URL(process.env.NEXT_PUBLIC_APP_URL!).origin
    )
      throw new Error('forbidden');
    client = await createServerSupabaseClient();
  }
  const {
    data: { user },
    error,
  } = await client.auth.getUser(authorization?.slice(7));
  if (error || !user) throw new Error('unauthorized');
  return {
    client,
    user,
    isNative: !!authorization || !!nativeContext(request.headers.get('cookie')),
  };
}
export async function ownerBillingContext(request: Request, organizationId: string) {
  const context = await billingRequestContext(request);
  const { data, error } = await context.client
    .from('organization_members')
    .select('role,status')
    .eq('organization_id', organizationId)
    .eq('user_id', context.user.id)
    .maybeSingle();
  if (error || data?.role !== 'owner' || data.status !== 'active') throw new Error('forbidden');
  return context;
}
