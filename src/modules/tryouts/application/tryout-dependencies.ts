import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { TryoutGateway } from '../domain/tryout';
import { SupabaseTryoutGateway } from '../infrastructure/supabase-tryout-gateway';

export async function defaultTryoutGateway(): Promise<TryoutGateway> {
  return new SupabaseTryoutGateway(await createServerSupabaseClient());
}
