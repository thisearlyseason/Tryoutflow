import { render, screen } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
}));

const responseCookies = vi.hoisted(() => ({
  set: vi.fn(),
}));

const createServerClientMock = vi.hoisted(() => vi.fn(() => ({ auth })));

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(),
  createServerClient: createServerClientMock,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: responseCookies.set,
  })),
}));

import { GET as callback } from '../../../src/app/(auth)/auth/callback/route';
import { handlePasswordRecovery } from '../../../src/app/(auth)/auth/recovery/route';
import { handleSignUp } from '../../../src/app/(auth)/auth/sign-up/route';
import { handleEmailVerification } from '../../../src/app/(auth)/auth/verification/route';
import InvitePage from '../../../src/app/(auth)/invite/[token]/page';
import { createOwnerAccount } from '../../../src/modules/identity/application/create-account';
import { requestEmailVerification } from '../../../src/modules/identity/application/request-email-verification';
import { requestPasswordRecovery as requestPasswordRecoveryCommand } from '../../../src/modules/identity/application/request-password-recovery';
import {
  safeInternalPath,
  signInWithPassword as signInWithPasswordCommand,
  type PasswordSignInAbuseProtection,
} from '../../../src/modules/identity/application/sign-in';
import { signOut } from '../../../src/modules/identity/application/sign-out';
import { proxy } from '../../../src/proxy';

function requestFor(pathname: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`);
}

const botToken = 'unit-test-bot-token';
const allowPasswordProtection: PasswordSignInAbuseProtection = {
  check: async () => ({ allowed: true }),
};
const allowAuthProtection = { check: async () => ({ allowed: true as const }) };

function signInWithPassword(
  input: Parameters<typeof signInWithPasswordCommand>[0],
  dependencies: Parameters<typeof signInWithPasswordCommand>[1] = {},
) {
  const record = input && typeof input === 'object' ? input : {};
  return signInWithPasswordCommand(
    { ...record, botVerificationToken: botToken },
    { abuseProtection: allowPasswordProtection, ...dependencies },
  );
}

function authFormRequest(path: string, fields: Record<string, string>) {
  return new NextRequest(`http://localhost${path}`, {
    body: new URLSearchParams({ ...fields, 'cf-turnstile-response': botToken }),
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/x-www-form-urlencoded',
      'x-vercel-forwarded-for': '203.0.113.8',
    },
    method: 'POST',
  });
}

describe('authentication session boundaries', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tryoutflow.test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    auth.getUser.mockReset();
    auth.exchangeCodeForSession.mockReset();
    auth.resetPasswordForEmail.mockReset();
    auth.resend.mockReset();
    auth.signInWithPassword.mockReset();
    auth.signUp.mockReset();
    auth.signOut.mockReset();
    auth.updateUser.mockReset();
    responseCookies.set.mockReset();
    createServerClientMock.mockClear();
  });

  it('redirects an anonymous app request to sign in with a safe return path', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await proxy(requestFor('/app/badlands/home'));

    expect(response.headers.get('location')).toContain('/sign-in?next=%2Fapp%2Fbadlands%2Fhome');
  });

  it('does not use an external next URL after password sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const result = await signInWithPassword({
      email: 'coach@example.com',
      password: 'correct horse battery staple',
      next: 'https://attacker.example/collect-session',
    });

    expect(result).toEqual({ ok: true, value: { redirectTo: '/app' } });
  });

  it.each([
    ['a protocol-relative URL', '//attacker.example/collect-session'],
    ['a backslash URL', '/\\attacker.example/collect-session'],
    ['a control-character URL', '/app\u0000attacker'],
  ])('does not use %s after password sign-in', async (_label, next) => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const result = await signInWithPassword({
      email: 'coach@example.com',
      password: 'correct horse battery staple',
      next,
    });

    expect(result).toEqual({ ok: true, value: { redirectTo: '/app' } });
  });

  it('preserves only a safe internal redirect path', () => {
    expect(safeInternalPath('/app/badlands?tab=staff')).toBe('/app/badlands?tab=staff');
  });

  it('denies a rate-limited password attempt before authenticating', async () => {
    const abuseProtection: PasswordSignInAbuseProtection = {
      check: async () => ({ allowed: false, reason: 'rate_limited' }),
    };

    const result = await signInWithPassword(
      {
        email: 'coach@example.com',
        password: 'correct horse battery staple',
      },
      { abuseProtection },
    );

    expect(result).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('fails closed when the configured abuse protection cannot be reached', async () => {
    const abuseProtection: PasswordSignInAbuseProtection = {
      check: async () => {
        throw new Error('rate limiter unavailable');
      },
    };

    const result = await signInWithPassword(
      {
        email: 'coach@example.com',
        password: 'correct horse battery staple',
      },
      { abuseProtection },
    );

    expect(result).toEqual({ ok: false, error: 'abuse_protection_unavailable' });
  });

  it('returns invalid-credential semantics when Supabase rejects password sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });

    const result = await signInWithPassword({
      email: 'coach@example.com',
      password: 'wrong password',
    });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('returns an invalid-session recovery redirect for an expired callback code', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Code verifier expired' },
    });

    const response = await callback(requestFor('/auth/callback?code=expired&next=/app/badlands'));

    expect(response.headers.get('location')).toContain('/sign-in?error=auth_callback_failed');
  });

  it('exchanges a valid callback code and redirects only to its safe return path', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });

    const response = await callback(
      requestFor('/auth/callback?code=valid-code&next=/app/badlands?tab=staff'),
    );

    expect(response.headers.get('location')).toBe('http://localhost/app/badlands?tab=staff');
  });

  it('forwards refreshed session cookies to downstream rendering and the browser response', async () => {
    const request = requestFor('/app/badlands/home');
    auth.getUser.mockImplementation(async () => {
      const calls = createServerClientMock.mock.calls as unknown as Array<
        [unknown, unknown, unknown]
      >;
      const options = calls.at(-1)?.[2] as {
        cookies: {
          setAll(
            cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>,
          ): void;
        };
      };

      options.cookies.setAll([
        { name: 'sb-first', value: 'first-value', options: { path: '/', httpOnly: true } },
      ]);
      options.cookies.setAll([
        { name: 'sb-refresh', value: 'refresh-value', options: { path: '/', httpOnly: true } },
      ]);

      return { data: { user: { id: 'user-1' } }, error: null };
    });

    const response = await proxy(request);

    expect(request.cookies.get('sb-first')?.value).toBe('first-value');
    expect(request.cookies.get('sb-refresh')?.value).toBe('refresh-value');
    expect(response.headers.get('x-middleware-request-cookie')).toContain('sb-first=first-value');
    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      'sb-refresh=refresh-value',
    );
    expect(response.cookies.get('sb-first')?.value).toBe('first-value');
    expect(response.cookies.get('sb-refresh')?.value).toBe('refresh-value');
    expect(response.headers.get('set-cookie')).toContain('sb-first=first-value');
    expect(response.headers.get('set-cookie')).toContain('sb-refresh=refresh-value');
  });

  it('offers a recovery state when an invitation token is invalid', async () => {
    render(
      await InvitePage({
        params: Promise.resolve({ token: 'invalid-token' }),
        searchParams: Promise.resolve({ error: 'invalid_or_expired' }),
      }),
    );

    expect(
      screen.getByRole('heading', { name: 'This invitation is no longer valid' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute(
      'href',
      '/sign-in',
    );
  });

  it('does not treat similarly named public paths as protected app routes', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await proxy(requestFor('/apple'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('clears the current session before returning to sign in', async () => {
    auth.signOut.mockResolvedValue({ error: null });

    const result = await signOut();

    expect(result).toEqual({ ok: true, value: { redirectTo: '/sign-in' } });
  });

  it('returns a non-success result when session sign-out fails', async () => {
    auth.signOut.mockResolvedValue({ error: { message: 'Session is unavailable' } });

    const result = await signOut();

    expect(result).toEqual({ ok: false, error: 'sign_out_failed' });
  });

  it('requests password recovery through a purpose-limited callback route', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    const result = await requestPasswordRecoveryCommand({
      email: 'coach@example.com',
      redirectTo: 'http://localhost/auth/callback?next=%2Freset-password',
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('does not disclose a provider failure while accepting a recovery request', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: 'User not found' },
    });

    const response = await handlePasswordRecovery(
      authFormRequest('/auth/recovery', { email: 'coach@example.com' }),
      { abuseProtection: allowAuthProtection },
    );

    expect(response.headers.get('location')).toBe('http://localhost/forgot-password?sent=1');
  });

  it('requests email verification through a purpose-limited callback route', async () => {
    auth.resend.mockResolvedValue({ data: {}, error: null });

    const result = await requestEmailVerification({
      email: 'coach@example.com',
      redirectTo: 'http://localhost/auth/callback?next=%2Fverify-email%3Fconfirmed%3D1',
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('shows a generic verification confirmation after provider failure', async () => {
    auth.resend.mockResolvedValue({ data: {}, error: { message: 'No user found' } });

    const response = await handleEmailVerification(
      authFormRequest('/auth/verification', { email: 'coach@example.com' }),
      { abuseProtection: allowAuthProtection },
    );

    expect(response.headers.get('location')).toBe('http://localhost/verify-email?sent=1');
  });

  it('creates an anonymous password account with a verification callback to onboarding', async () => {
    auth.signUp.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null });

    const response = await handleSignUp(
      authFormRequest('/auth/sign-up', {
        email: 'new-owner@example.com',
        password: 'correct horse battery staple',
        confirmPassword: 'correct horse battery staple',
      }),
      { abuseProtection: allowAuthProtection },
    );

    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'new-owner@example.com',
      password: 'correct horse battery staple',
      options: { emailRedirectTo: 'http://localhost/auth/callback?next=%2Fstart' },
    });
    expect(response.headers.get('location')).toBe('http://localhost/verify-email?signup=1');
  });

  it('does not create an account when bot verification fails', async () => {
    const response = await handleSignUp(
      authFormRequest('/auth/sign-up', {
        email: 'new-owner@example.com',
        password: 'correct horse battery staple',
        confirmPassword: 'correct horse battery staple',
      }),
      {
        abuseProtection: {
          check: async () => ({ allowed: false, reason: 'bot_verification_required' as const }),
        },
      },
    );
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('http://localhost/sign-up?error=unavailable');
  });

  it('returns the same signup confirmation when Supabase masks or reports an existing account', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: null },
      error: { message: 'already registered' },
    });
    await expect(
      createOwnerAccount({
        email: 'existing@example.com',
        password: 'correct horse battery staple',
        emailRedirectTo: 'http://localhost/auth/callback?next=%2Fstart',
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
  });
});
