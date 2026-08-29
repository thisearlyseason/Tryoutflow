import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { SupabaseEvaluationGateway } from '../infrastructure/supabase-evaluation-gateway';
import type { EvaluationGateway } from './contracts';

export async function defaultEvaluationGateway(): Promise<EvaluationGateway> {
  return new SupabaseEvaluationGateway(await createServerSupabaseClient());
}
