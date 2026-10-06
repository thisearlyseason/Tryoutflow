import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';

import { isNeutralAuthOutcome } from './non-enumerating-auth-outcome';

const createAccountSchema = z.object({
  email: z.email().max(254),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[a-z]/u)
    .regex(/[A-Z]/u)
    .regex(/\d/u)
    .regex(/[^A-Za-z0-9\s]/u),
  emailRedirectTo: z.url().max(2_048),
});

/**
 * Account creation is deliberately non-oracular: a syntactically accepted
 * request receives the same response whether the address is new or already in
 * Supabase Auth. The provider remains responsible for the verification email.
 */
export async function createOwnerAccount(
  input: unknown,
): Promise<AppResult<void, 'invalid_input' | 'account_creation_unavailable'>> {
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: parsed.data.emailRedirectTo },
  });
  if (error && !isNeutralAuthOutcome(error, 'signup'))
    return failure('account_creation_unavailable');
  return success(undefined);
}
