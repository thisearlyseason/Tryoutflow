import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const preflight = vi.hoisted(() => vi.fn());
vi.mock('../../src/modules/organizations/application/organization-route-preflight', () => ({
  organizationRoutePreflight: preflight,
}));

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
    preflight.mockReset().mockResolvedValue(true);
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
    '/how-to',
    '/how-to/?audience=director',
    '/privacy',
    '/terms',
    '/fonts/manrope/Manrope-Variable.ttf',
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

  it.each(['/', '/how-to?audience=director', '/how-to/', '/pricing'])(
    'refreshes cookie-bearing public page %s without redirecting or loading tenant data',
    async (path) => {
      createServerClient.mockImplementation((_url, _key, options) => ({
        auth: {
          getUser: async () => {
            options.cookies.setAll([
              {
                name: 'sb-synthetic-auth-token',
                value: 'rotated-synthetic-session',
                options: { path: '/', sameSite: 'lax' },
              },
            ]);
            return getUser();
          },
        },
      }));
      getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
      const request = requestFor(path, 'sb-synthetic-auth-token=existing-synthetic-session');
      const response = await proxy(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('set-cookie')).toContain(
        'sb-synthetic-auth-token=rotated-synthetic-session',
      );
      expect(request.cookies.get('sb-synthetic-auth-token')?.value).toBe(
        'rotated-synthetic-session',
      );
      expect(getUser).toHaveBeenCalledOnce();
      expect(preflight).not.toHaveBeenCalled();
    },
  );

  it('keeps expired sessions on public pages and preserves cookie clearing', async () => {
    createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([
        { name: 'sb-synthetic-auth-token', value: '', options: { path: '/', maxAge: 0 } },
      ]);
      return { auth: { getUser } };
    });
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid refresh token' },
    });
    const response = await proxy(requestFor('/how-to', 'sb-synthetic-auth-token=expired'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(preflight).not.toHaveBeenCalled();
  });

  it('recognizes chunked sessions while leaving static fonts untouched', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    await proxy(requestFor('/how-to', 'sb-synthetic-auth-token.0=chunk-zero'));
    const font = await proxy(
      requestFor('/fonts/manrope/Manrope-Variable.ttf', 'sb-synthetic-auth-token=session'),
    );
    expect(font.status).toBe(200);
    expect(font.headers.get('cache-control')).toBeNull();
    expect(createServerClient).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
  });

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

  it('denies before streaming and preserves refresh cookies without leaking the route', async () => {
    createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.setAll([
        { name: 'sb-session', value: 'refreshed-session', options: { httpOnly: true, path: '/' } },
      ]);
      return { auth: { getUser } };
    });
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    preflight.mockResolvedValue(false);
    const response = await proxy(requestFor('/app/other-tenant/tryouts/private/rosters'));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain('sb-session=refreshed-session');
    expect(await response.text()).toBe('Page not found.');
  });

  it('redirects anonymous platform administration requests to sign in', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await proxy(requestFor('/platform/health'));

    expect(response.headers.get('location')).toBe(
      `http://localhost/sign-in?next=${encodeURIComponent('/platform/health')}`,
    );
  });
});
