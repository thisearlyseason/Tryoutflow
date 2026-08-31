import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
const createServerClient = vi.hoisted(() => vi.fn());

vi.mock('@supabase/ssr', () => ({ createServerClient }));

import { proxy } from '../../src/proxy';

function requestFor(path: string, cookie = 'sb-session=existing-session'): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: { cookie } });
}

describe('proxy public marketing boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tryoutflow.test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key';
    getUser.mockReset();
    createServerClient.mockReset();
    createServerClient.mockImplementation(() => ({ auth: { getUser } }));
  });

  it.each([
    '/',
    '/?campaign=fall',
    '/features',
    '/features/?campaign=fall',
    '/for/teams',
    '/for/teams/',
    '/for/clubs',
    '/for/associations',
    '/pricing',
    '/demo',
    '/privacy',
    '/terms',
  ])(
    'does not create an auth client or fetch a user for public marketing path %s',
    async (path) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const response = await proxy(requestFor(path));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(createServerClient).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    },
  );

  it.each([
    '/app',
    '/app/tryout',
    '/sign-in',
    '/register/fall-camp',
    '/api/public/registrations',
    '/features-preview',
    '/pricing.json',
    '/for/teams.json',
    '/for/teams/extra',
    '/privacy-policy',
  ])('keeps non-marketing path %s behind the auth client boundary', async (path) => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await proxy(requestFor(path));

    expect(createServerClient).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
    if (path === '/app' || path.startsWith('/app/')) {
      expect(response.headers.get('location')).toBe(
        `http://localhost/sign-in?next=${encodeURIComponent(path)}`,
      );
    } else {
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('preserves session refresh cookies on protected requests without refreshing public pages', async () => {
    createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([
        { name: 'sb-session', value: 'refreshed-session', options: { httpOnly: true, path: '/' } },
      ]);
      return { auth: { getUser } };
    });
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const protectedResponse = await proxy(requestFor('/app/team'));
    const publicResponse = await proxy(requestFor('/pricing'));

    expect(protectedResponse.headers.get('set-cookie')).toContain('sb-session=refreshed-session');
    expect(publicResponse.headers.get('set-cookie')).toBeNull();
    expect(createServerClient).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
  });

  it('redirects anonymous platform administration requests to sign in', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await proxy(requestFor('/platform/health'));

    expect(response.headers.get('location')).toBe(
      `http://localhost/sign-in?next=${encodeURIComponent('/platform/health')}`,
    );
  });
});
