import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  cookies: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: auth.cookies }));
vi.mock('../../../src/infrastructure/supabase/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/infrastructure/supabase/server')>()),
  createServerSupabaseClient: auth.createClient,
}));

import MarketingLayout from '../../../src/app/(marketing)/layout';

beforeEach(() => {
  vi.clearAllMocks();
  auth.cookies.mockResolvedValue({ getAll: () => [] });
  auth.createClient.mockResolvedValue({ auth: { getUser: auth.getUser } });
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
});

function sessionCookies(name = 'sb-synthetic-auth-token') {
  auth.cookies.mockResolvedValue({ getAll: () => [{ name, value: 'untrusted-synthetic-cookie' }] });
}

describe('public marketing account navigation', () => {
  it.each([
    { cookies: [] },
    { cookies: [{ name: 'theme', value: 'dark' }] },
    { cookies: [{ name: 'sb-synthetic-auth-token-code-verifier', value: 'untrusted' }] },
  ])(
    'keeps anonymous navigation public without an auth or tenant lookup: %j',
    async ({ cookies }) => {
      auth.cookies.mockResolvedValue({ getAll: () => cookies });
      render(await MarketingLayout({ children: <h1>How to</h1> }));
      const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
      expect(nav.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
      expect(nav.getByRole('link', { name: 'Try the demo' })).toHaveAttribute('href', '/demo');
      expect(nav.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
      expect(auth.createClient).not.toHaveBeenCalled();
      expect(auth.getUser).not.toHaveBeenCalled();
    },
  );

  it.each(['sb-synthetic-auth-token', 'sb-synthetic-auth-token.0', 'sb-synthetic-auth-token.1'])(
    'uses verified identity for Dashboard with base or chunked session cookie %s',
    async (name) => {
      sessionCookies(name);
      auth.getUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
      render(await MarketingLayout({ children: <h1>How to</h1> }));
      const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
      const dashboard = nav.getByRole('link', { name: 'Dashboard' });
      expect(dashboard).toHaveAttribute('href', '/app');
      expect(dashboard).toHaveClass(
        'min-h-[var(--target-mobile)]',
        'focus-visible:ring-[var(--color-focus)]',
      );
      expect(nav.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
      expect(nav.getByRole('link', { name: 'How to' })).toHaveAttribute('href', '/how-to');
      expect(auth.getUser).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { data: { user: null }, error: null },
    { data: { user: null }, error: { message: 'expired or invalid session' } },
    { data: { user: { id: 'unverified' } }, error: { message: 'verification failed' } },
  ])('does not trust cookie presence or a failed verification result: %j', async (result) => {
    sessionCookies();
    auth.getUser.mockResolvedValue(result);
    render(await MarketingLayout({ children: <h1>How to</h1> }));
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('resolves identity before rendering the header, with no signed-out hydration placeholder', async () => {
    sessionCookies();
    let resolveUser!: (result: { data: { user: { id: string } }; error: null }) => void;
    auth.getUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUser = resolve;
        }),
    );
    let resolved = false;
    const layout = MarketingLayout({ children: <h1>How to</h1> }).then((value) => {
      resolved = true;
      return value;
    });
    await vi.waitFor(() => expect(auth.getUser).toHaveBeenCalledOnce());
    expect(resolved).toBe(false);
    resolveUser({ data: { user: { id: 'synthetic-user' } }, error: null });
    const html = renderToStaticMarkup(await layout);
    expect(html).toContain('href="/app"');
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('href="/sign-in"');
    expect(html).not.toContain('untrusted-synthetic-cookie');
    expect(html).not.toContain('synthetic-user');
  });

  it('does not reuse a verified user across separate signed-in and signed-out requests', async () => {
    sessionCookies();
    auth.getUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
    const signedIn = renderToStaticMarkup(await MarketingLayout({ children: <h1>How to</h1> }));
    auth.cookies.mockResolvedValue({ getAll: () => [] });
    const signedOut = renderToStaticMarkup(await MarketingLayout({ children: <h1>How to</h1> }));
    expect(signedIn).toContain('Dashboard');
    expect(signedOut).not.toContain('Dashboard');
    expect(signedOut).toContain('href="/sign-in"');
    expect(auth.getUser).toHaveBeenCalledOnce();
  });
});
