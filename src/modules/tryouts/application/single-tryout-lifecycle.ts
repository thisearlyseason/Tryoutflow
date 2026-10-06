import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/infrastructure/supabase/database.types';

const lifecycleSchema = z.object({
  version: z.number().optional(),
  single: z.boolean(),
  sealed: z.boolean(),
  locked: z.boolean(),
  locksAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
  lastSessionAt: z.string().optional(),
});
export type SingleTryoutLifecycle = z.infer<typeof lifecycleSchema>;

export async function loadSingleTryoutLifecycle(
  client: SupabaseClient<Database>,
  organizationId: string,
  tryoutId: string,
): Promise<SingleTryoutLifecycle> {
  const { data, error } = await client.rpc('get_single_tryout_lifecycle', {
    p_organization_id: organizationId,
    p_tryout_id: tryoutId,
  });
  if (error) throw error;
  return lifecycleSchema.parse(data);
}
