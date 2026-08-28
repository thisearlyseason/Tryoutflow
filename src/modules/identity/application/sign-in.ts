import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';

const signInInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type SignInError = 'invalid_input' | 'invalid_credentials';

export function safeInternalPath(next: string | null | undefined, fallback = '/app'): string {
  if (
    !next ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.startsWith('/\\') ||
    next.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(next)
  ) {
    return fallback;
  }

  try {
    return new URL(next, 'https://tryoutflow.local').origin === 'https://tryoutflow.local'
      ? next
      : fallback;
  } catch {
    return fallback;
  }
}

export async function signInWithPassword(
  input: unknown,
): Promise<AppResult<{ redirectTo: string }, SignInError>> {
  const parsedInput = signInInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return failure('invalid_input');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsedInput.data.email,
    password: parsedInput.data.password,
  });

  if (error) {
    return failure('invalid_credentials');
  }

  return success({ redirectTo: safeInternalPath(parsedInput.data.next) });
}
