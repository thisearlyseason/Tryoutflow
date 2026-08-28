import { createBrowserClient } from '@supabase/ssr';

import type { Database } from './database.types';
import { getClientEnvironment } from '../../lib/env';

export function createBrowserSupabaseClient() {
  const environment = getClientEnvironment();

  return createBrowserClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
