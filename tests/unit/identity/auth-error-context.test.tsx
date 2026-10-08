import { render, screen } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const passwordAuth = vi.hoisted(() => vi.fn());
const serverClient = vi.hoisted(() =>
  vi.fn(async () => ({ auth: { signInWithPassword: passwordAuth } })),
);
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: serverClient,
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: vi.fn(),
}));
vi.mock('../../../src/modules/identity/ui/bot-challenge', () => ({
  getBotChallengeConfiguration: () => ({ deterministicToken: 'synthetic-context-test-token' }),
}));

import { handleSignIn } from '../../../src/app/(auth)/auth/sign-in/request-handler';
import { handleSignUp } from '../../../src/app/(auth)/auth/sign-up/request-handler';
import { handleEmailVerification } from '../../../src/app/(auth)/auth/verification/request-handler';
import SignInPage from '../../../src/app/(auth)/sign-in/page';

function authFormRequest(path: string, fields: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
      'x-vercel-forwarded-for': '203.0.113.8',
    },
    body: new URLSearchParams({
      email: 'synthetic-context@example.test',
      password: 'SyntheticOnly-123',
      'cf-turnstile-response': 'synthetic-context-test-token',
      ...fields,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  passwordAuth.mockResolvedValue({ data: {}, error: null });
});

describe('participant signup error context', () => {
  it.each([
    ['participant', '&purpose=participant'],
    ['', ''],
  ])('preserves only the recognized purpose %s on password mismatch', async (purpose, suffix) => {
    const check = vi.fn(async () => ({ allowed: true as const }));
    const createAccount = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const response = await handleSignUp(
      authFormRequest('/auth/sign-up', { confirmPassword: 'SyntheticOnly-456', purpose }),
      { abuseProtection: { check }, createAccount },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `http://localhost/sign-up?error=invalid_input${suffix}`,
    );
    expect(check).not.toHaveBeenCalled();
    expect(createAccount).not.toHaveBeenCalled();
    expect(serverClient).not.toHaveBeenCalled();
  });
});

describe('password sign-in error destinations', () => {
  it.each(['invalid_credentials', 'email_not_confirmed'] as const)(
    'retains a participant destination after %s without changing provider arguments',
    async (error) => {
      passwordAuth.mockResolvedValue({ data: {}, error: { code: error, message: error } });
      const check = vi.fn(async () => ({ allowed: true as const }));
      const response = await handleSignIn(
        authFormRequest('/auth/sign-in', { next: '/participant' }),
        { abuseProtection: { check } },
      );
      const redirect = new URL(response.headers.get('location')!);

      expect(response.status).toBe(303);
      expect(redirect.origin).toBe('http://localhost');
      expect(redirect.pathname).toBe('/sign-in');
      expect(redirect.searchParams.get('error')).toBe(error);
      expect(redirect.searchParams.get('next')).toBe('/participant');
      expect(check).toHaveBeenCalledOnce();
      expect(passwordAuth).toHaveBeenCalledExactlyOnceWith({
        email: 'synthetic-context@example.test',
        password: 'SyntheticOnly-123',
      });
    },
  );

  it.each(['bot_verification_required', 'rate_limited', 'abuse_protection_unavailable'] as const)(
    'retains an internal query and fragment after %s before contacting auth',
    async (reason) => {
      const next = '/app/qa/home?tab=staff#review';
      const check = vi.fn(async () => ({ allowed: false as const, reason }));
      const response = await handleSignIn(authFormRequest('/auth/sign-in', { next }), {
        abuseProtection: { check },
      });
      const redirect = new URL(response.headers.get('location')!);

      expect(response.status).toBe(303);
      expect(redirect.origin).toBe('http://localhost');
      expect(redirect.pathname).toBe('/sign-in');
      expect(redirect.searchParams.get('error')).toBe(reason);
      expect(redirect.searchParams.get('next')).toBe(next);
      expect(serverClient).not.toHaveBeenCalled();
      expect(passwordAuth).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://attacker.example/collect-session',
    '//attacker.example/collect-session',
    '/\\attacker.example/collect-session',
    '/app\\attacker',
    '/app\u0000attacker',
    '/app\nattacker',
    '',
  ])('does not carry an unsafe or empty destination %j through an error', async (next) => {
    const response = await handleSignIn(authFormRequest('/auth/sign-in', { next }), {
      abuseProtection: {
        check: async () => ({ allowed: false, reason: 'bot_verification_required' }),
      },
    });

    expect(response.headers.get('location')).toBe(
      'http://localhost/sign-in?error=bot_verification_required',
    );
    expect(serverClient).not.toHaveBeenCalled();
  });

  it('leaves malformed form rejection independent of its proposed return destination', async () => {
    const check = vi.fn(async () => ({ allowed: true as const }));
    const request = authFormRequest('/auth/sign-in', {
      next: '/participant',
      unexpected: 'synthetic-only',
    });
    const response = await handleSignIn(request, { abuseProtection: { check } });

    expect(response.headers.get('location')).toBe('http://localhost/sign-in?error=invalid_input');
    expect(check).not.toHaveBeenCalled();
    expect(serverClient).not.toHaveBeenCalled();
  });
});

describe('participant verification retry context', () => {
  it.each([
    ['participant', '&purpose=participant'],
    ['', ''],
  ])('retains only recognized purpose %s after challenge denial', async (purpose, suffix) => {
    const check = vi.fn(async () => ({
      allowed: false as const,
      reason: 'bot_verification_required' as const,
    }));
    const command = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const request = new NextRequest('http://localhost/auth/verification', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/x-www-form-urlencoded',
        'x-vercel-forwarded-for': '203.0.113.8',
      },
      body: new URLSearchParams({
        email: 'synthetic-context@example.test',
        purpose,
        'cf-turnstile-response': 'synthetic-context-test-token',
      }),
    });
    const response = await handleEmailVerification(request, {
      abuseProtection: { check },
      command,
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `http://localhost/verify-email?error=unavailable${suffix}`,
    );
    expect(check).toHaveBeenCalledOnce();
    expect(command).not.toHaveBeenCalled();
    expect(serverClient).not.toHaveBeenCalled();
  });

  it.each([
    ['/participant', '/verify-email?purpose=participant'],
    ['/app/qa/home', '/verify-email'],
  ])('keeps verification help aligned with sign-in destination %s', async (next, expected) => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ next, error: 'email_not_confirmed' }),
      }),
    );

    expect(screen.getByRole('link', { name: 'Need a new verification link?' })).toHaveAttribute(
      'href',
      expected,
    );
    expect(serverClient).not.toHaveBeenCalled();
  });
});
