import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { SupabaseRosterGateway } from '../infrastructure/supabase-roster-gateway';

export async function defaultRosterGateway() {
  return new SupabaseRosterGateway(await createServerSupabaseClient());
}
