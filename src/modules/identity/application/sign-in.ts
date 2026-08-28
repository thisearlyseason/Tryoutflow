import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';

const signInInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type SignInError = 'invalid_input' | 'invalid_credentials';

export type PasswordSignInAbuseProtection = {
  check(attempt: {
    email: string;
    botVerificationToken?: string;
  }): Promise<
    { allowed: true } | { allowed: false; reason: 'rate_limited' | 'bot_verification_required' }
  >;
};

export type SignInDependencies = {
  abuseProtection?: PasswordSignInAbuseProtection;
};

const localPasswordSignInAbuseProtection: PasswordSignInAbuseProtection = {
  async check() {
    return { allowed: true };
  },
};

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
  dependencies: SignInDependencies = {},
): Promise<
  AppResult<
    { redirectTo: string },
    SignInError | 'rate_limited' | 'bot_verification_required' | 'abuse_protection_unavailable'
  >
> {
  const parsedInput = signInInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return failure('invalid_input');
  }

  try {
    const decision = await (
      dependencies.abuseProtection ?? localPasswordSignInAbuseProtection
    ).check({
      email: parsedInput.data.email,
    });

    if (!decision.allowed) {
      return failure(decision.reason);
    }
  } catch {
    return failure('abuse_protection_unavailable');
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
