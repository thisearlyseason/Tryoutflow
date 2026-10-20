import 'server-only';

import { createClient } from '@supabase/supabase-js';

import { getServerEnvironment } from '../../lib/env';
import type { Database } from './database.types';

/**
 * This client bypasses Row Level Security and must only be imported by narrow,
 * server-side operational handlers such as webhooks and scheduled jobs.
 */
export function createAdminSupabaseClient() {
  const environment = getServerEnvironment();

  return createClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
