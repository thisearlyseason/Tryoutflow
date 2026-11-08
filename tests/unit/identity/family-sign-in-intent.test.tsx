import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/modules/identity/ui/bot-challenge', () => ({
  getBotChallengeConfiguration: () => ({}),
}));
vi.mock('@/modules/identity/ui/sign-in-form', () => ({
  SignInForm: () => <form aria-label="Sign in form" />,
}));
import SignIn from '@/app/(auth)/sign-in/page';
describe('family account sign-in intent', () => {
  it.each(['/participant', '/participant/account'])('keeps family guidance at %s', async (next) => {
    render(await SignIn({ searchParams: Promise.resolve({ next }) }));
    expect(screen.getByText(/Sign in to your athlete and family portal/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Create an athlete or family account' }),
    ).toHaveAttribute('href', '/sign-up?purpose=participant');
    expect(screen.getByRole('link', { name: 'New here? Create an account' })).toHaveAttribute(
      'href',
      '/sign-up?purpose=participant',
    );
  });
});
