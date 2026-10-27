import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: auth.getUser } }),
}));
vi.mock('../../../src/modules/identity/ui/private-session-boundary', () => ({
  PrivateSessionBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

import SignInPage from '../../../src/app/(auth)/sign-in/page';
import SignUpPage from '../../../src/app/(auth)/sign-up/page';
import ForgotPasswordPage from '../../../src/app/(auth)/forgot-password/page';
import ResetPasswordPage from '../../../src/app/(auth)/reset-password/page';
import StartPage from '../../../src/app/(auth)/start/page';
import VerifyEmailPage from '../../../src/app/(auth)/verify-email/page';
import { AuthShell } from '../../../src/components/layout/auth-shell';

describe('Performance Lab authentication shell', () => {
  beforeEach(() => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'signed-in-fixture' } } });
  });
  it('pairs one focused form heading with sports-performance product proof', () => {
    render(
      <AuthShell
        description="Use the credentials connected to your coaching account."
        eyebrow="Welcome back"
        footer={<a href="/forgot-password">Forgot your password?</a>}
        proofItems={[
          'Registration and check-in',
          'Evidence-based evaluation',
          'Roster decisions and communication',
        ]}
        title="Sign in to TryoutFlow"
      >
        <form>
          <label htmlFor="email">Email</label>
          <input id="email" />
          <button type="submit">Sign in</button>
        </form>
      </AuthShell>,
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Sign in to TryoutFlow' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'TryoutFlow product summary' })).toHaveTextContent(
      'Plan. Run. Evaluate.',
    );
    expect(screen.getByText('Evidence-based evaluation')).toBeVisible();
    expect(screen.getByRole('contentinfo')).toContainElement(
      screen.getByRole('link', { name: 'Forgot your password?' }),
    );
  });

  it('keeps the product mark meaningful without duplicating the page heading', () => {
    render(
      <AuthShell description="Create an owner account." title="Start your organization">
        <button type="button">Create account</button>
      </AuthShell>,
    );

    expect(screen.getByRole('link', { name: 'TryoutFlow home' })).toContainElement(
      screen.getByRole('img', { name: 'TryoutFlow' }),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start your organization');
  });

  it('uses the shared shell and accessible controls for sign-in', async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('region', { name: 'TryoutFlow product summary' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Family portal', exact: true })).toHaveAttribute(
      'href',
      '/participant',
    );
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveClass('field-control');
    expect(screen.getByLabelText(/^Password/)).toHaveClass('field-control');
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveClass('button-primary');
  });

  it('uses the shared shell for account creation and organization onboarding', async () => {
    const signUp = render(await SignUpPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { name: 'Create your organization account' })).toBeVisible();
    expect(screen.getByText(/after verification, you’ll create your organization/i)).toBeVisible();
    expect(screen.getByRole('region', { name: 'TryoutFlow product summary' })).toBeVisible();
    expect(screen.getByLabelText('Password', { exact: true })).toBeVisible();
    expect(screen.getByLabelText('Confirm password', { exact: true })).toBeVisible();
    signUp.unmount();

    render(await StartPage());
    expect(screen.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'TryoutFlow product summary' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create organization' })).toHaveClass(
      'button-primary',
    );
  });

  it('does not render organization setup for a signed-out or expired session', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    await expect(StartPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(screen.queryByRole('button', { name: 'Create organization' })).toBeNull();
  });

  it('keeps recovery and verification states inside the shared sports shell', async () => {
    const forgot = render(
      await ForgotPasswordPage({ searchParams: Promise.resolve({ sent: '1' }) }),
    );
    expect(screen.getByRole('region', { name: 'TryoutFlow product summary' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Email/ })).toHaveClass('field-control');
    expect(screen.getByRole('button', { name: 'Send reset instructions' })).toHaveClass(
      'button-primary',
    );
    forgot.unmount();

    const verify = render(await VerifyEmailPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('region', { name: 'TryoutFlow product summary' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send verification link' })).toHaveClass(
      'button-primary',
    );
    verify.unmount();

    render(await ResetPasswordPage({ searchParams: Promise.resolve({ error: 'reset_failed' }) }));
    expect(screen.getByRole('region', { name: 'TryoutFlow product summary' })).toBeVisible();
    expect(screen.getByLabelText(/^New password/)).toHaveClass('field-control');
    expect(screen.getByRole('button', { name: 'Save new password' })).toHaveClass('button-primary');
  });
});
