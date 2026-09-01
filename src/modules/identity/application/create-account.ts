import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { success, type AppResult } from '../../../lib/result';

const createAccountSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  emailRedirectTo: z.url().max(2_048),
});

/**
 * Account creation is deliberately non-oracular: a syntactically accepted
 * request receives the same response whether the address is new or already in
 * Supabase Auth. The provider remains responsible for the verification email.
 */
export async function createOwnerAccount(
  input: unknown,
): Promise<AppResult<void, 'invalid_input'>> {
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: parsed.data.emailRedirectTo },
  });
  return success(undefined);
}
