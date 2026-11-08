import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ path: '/participant', context: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.path }));
vi.mock('@/modules/registration/application/participant-context', () => ({
  requireParticipantContext: mocks.context,
}));
vi.mock('@/modules/identity/ui/private-session-boundary', () => ({
  PrivateSessionBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
import Layout from '@/app/(participant)/participant/layout';
import Account from '@/app/(participant)/participant/account/page';
import PortalError from '@/app/(participant)/participant/error';
beforeEach(() => {
  mocks.path = '/participant';
  mocks.context.mockReset();
});
function context(profile: unknown = { display_name: 'Family member' }, error: unknown = null) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: profile, error }) }));
  const from = vi.fn(() => ({ select: () => ({ eq }) }));
  mocks.context.mockResolvedValue({
    user: { id: 'family-user', email: 'family@example.test', user_metadata: {} },
    client: { from },
  });
  return { eq, from };
}
describe('family portal controls', () => {
  it.each(['/participant', '/participant/account'])(
    'keeps account, help and POST sign out together at %s',
    async (path) => {
      context();
      mocks.path = path;
      render(await Layout({ children: <h1>Private family content</h1> }));
      const nav = screen.getByRole('navigation', { name: 'Family portal navigation' });
      expect(within(nav).getByRole('link', { name: 'Account' })).toHaveAttribute(
        'href',
        '/participant/account',
      );
      const url = new URL(
        within(nav).getByRole('link', { name: 'Help and guides' }).getAttribute('href')!,
        'https://test.example',
      );
      expect(url.searchParams.get('audience')).toBe('parents');
      expect(url.searchParams.get('returnTo')).toBe(path);
      expect(within(nav).getByRole('button', { name: 'Sign out' }).closest('form')).toHaveAttribute(
        'method',
        'post',
      );
      expect(within(nav).getByRole('button', { name: 'Sign out' }).closest('form')).toHaveAttribute(
        'action',
        '/auth/sign-out?returnTo=participant',
      );
      expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
        'href',
        '#participant-main',
      );
    },
  );
  it('shows personal account details scoped to the current identity without membership', async () => {
    const { eq } = context();
    render(await Account());
    expect(screen.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
    expect(screen.getByText('family@example.test')).toBeVisible();
    expect(screen.getByText('Family member', { exact: true })).toBeVisible();
    expect(eq).toHaveBeenCalledWith('id', 'family-user');
    expect(screen.getByRole('link', { name: 'Reset password' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Back to family portal' })).toHaveAttribute(
      'href',
      '/participant',
    );
    expect(screen.queryByRole('link', { name: /organization|billing/i })).toBeNull();
  });
  it('does not invent profile details when the profile is missing or unavailable', async () => {
    context(null);
    const view = render(await Account());
    expect(screen.getByText('Not set')).toBeVisible();
    view.unmount();
    context(null, { message: 'offline' });
    render(await Account());
    expect(screen.getByRole('alert')).toHaveTextContent('Profile details could not load');
    expect(screen.getByText('family@example.test')).toBeVisible();
  });
  it('retains session controls around a recoverable portal error and retries on request', async () => {
    context();
    const reset = vi.fn();
    render(
      await Layout({
        children: <PortalError error={new Error('private diagnostic')} reset={reset} />,
      }),
    );
    expect(screen.getByRole('navigation', { name: 'Family portal navigation' })).toBeVisible();
    expect(screen.queryByText('private diagnostic')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
