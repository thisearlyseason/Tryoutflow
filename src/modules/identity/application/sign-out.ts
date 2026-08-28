import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';

export type SignOutError = 'sign_out_failed';

export async function signOut(): Promise<AppResult<{ redirectTo: string }, SignOutError>> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return failure('sign_out_failed');
  }

  return success({ redirectTo: '/sign-in' });
}
