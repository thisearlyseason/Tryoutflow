import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';

const verificationInputSchema = z.object({
  email: z.email(),
  redirectTo: z.url(),
});

export type EmailVerificationError = 'invalid_input' | 'verification_request_failed';

export async function requestEmailVerification(
  input: unknown,
): Promise<AppResult<void, EmailVerificationError>> {
  const parsedInput = verificationInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return failure('invalid_input');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resend({
    email: parsedInput.data.email,
    options: { emailRedirectTo: parsedInput.data.redirectTo },
    type: 'signup',
  });

  if (error) {
    return failure('verification_request_failed');
  }

  return success(undefined);
}
