import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';

const resetPasswordInputSchema = z.object({
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(/[a-z]/u)
    .regex(/[A-Z]/u)
    .regex(/\d/u)
    .regex(/[^A-Za-z0-9\s]/u),
});

export type ResetPasswordError = 'invalid_input' | 'password_reset_failed';

export async function resetPassword(input: unknown): Promise<AppResult<void, ResetPasswordError>> {
  const parsedInput = resetPasswordInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return failure('invalid_input');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: parsedInput.data.password });

  if (error) {
    return failure('password_reset_failed');
  }

  return success(undefined);
}
