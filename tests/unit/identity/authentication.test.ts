import { render, screen } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

const responseCookies = vi.hoisted(() => ({
  set: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(),
  createServerClient: vi.fn(() => ({ auth })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: responseCookies.set,
  })),
}));

import { GET as callback } from '../../../src/app/(auth)/auth/callback/route';
import InvitePage from '../../../src/app/(auth)/invite/[token]/page';
import { signInWithPassword } from '../../../src/modules/identity/application/sign-in';
import { signOut } from '../../../src/modules/identity/application/sign-out';
import { proxy } from '../../../src/proxy';

function requestFor(pathname: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`);
}

describe('authentication session boundaries', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tryoutflow.test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    auth.getUser.mockReset();
    auth.exchangeCodeForSession.mockReset();
    auth.signInWithPassword.mockReset();
    auth.signOut.mockReset();
    responseCookies.set.mockReset();
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

  it('returns an invalid-session recovery redirect for an expired callback code', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Code verifier expired' },
    });

    const response = await callback(requestFor('/auth/callback?code=expired&next=/app/badlands'));

    expect(response.headers.get('location')).toContain('/sign-in?error=auth_callback_failed');
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

  it('clears the current session before returning to sign in', async () => {
    auth.signOut.mockResolvedValue({ error: null });

    const result = await signOut();

    expect(result).toEqual({ ok: true, value: { redirectTo: '/sign-in' } });
  });
});
