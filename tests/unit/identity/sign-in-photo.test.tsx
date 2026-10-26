import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthShell } from '@/components/layout/auth-shell';
import SignInPage from '@/app/(auth)/sign-in/page';

describe('licensed sign-in photography without auth behavior changes', () => {
  it('renders a local decorative responsive optimized image only when opted in', () => {
    const view = render(
      <AuthShell sportsBackground title="Sign in" description="Fixture">
        <button>Continue</button>
      </AuthShell>,
    );
    const image = view.container.querySelector<HTMLImageElement>('.auth-background-image')!;
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('sizes', '100vw');
    expect(image.getAttribute('src')).toContain('team-training.jpg');
    expect(image).toHaveAttribute('srcset');
    expect(image.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(view.container.querySelector('.auth-page-photo')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
  });
  it('does not add photography to other auth/public shells by default', () => {
    const view = render(
      <AuthShell title="Join with code" description="Fixture">
        <p>Public code flow</p>
      </AuthShell>,
    );
    expect(view.container.querySelector('.auth-background-image')).toBeNull();
    expect(view.container.querySelector('.auth-page-photo')).toBeNull();
  });
  it('keeps sign-in error, password controls and participant continuation intact', async () => {
    const view = render(
      await SignInPage({
        searchParams: Promise.resolve({ error: 'invalid_credentials', next: '/participant' }),
      }),
    );
    expect(view.container.querySelector('.auth-background-image')).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not verify');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeEnabled();
    expect(
      screen.getByRole('link', { name: 'Create an athlete or family account' }),
    ).toHaveAttribute('href', '/sign-up?purpose=participant');
    expect(view.container.querySelector('input[name="next"]')).toHaveValue('/participant');
  });
});
