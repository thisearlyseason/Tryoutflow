import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';

const recoveryInputSchema = z.object({
  email: z.email(),
  redirectTo: z.url(),
});

export type PasswordRecoveryError = 'invalid_input' | 'recovery_request_failed';

export async function requestPasswordRecovery(
  input: unknown,
): Promise<AppResult<void, PasswordRecoveryError>> {
  const parsedInput = recoveryInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return failure('invalid_input');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsedInput.data.email, {
    redirectTo: parsedInput.data.redirectTo,
  });

  if (error) {
    return failure('recovery_request_failed');
  }

  return success(undefined);
}
