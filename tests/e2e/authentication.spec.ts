import { expect, test } from '@playwright/test';

test('shows the password sign-in form', async ({ page }) => {
  await page.goto('/sign-in');

  await expect(page.getByRole('heading', { name: 'Sign in to your organization' })).toBeVisible();
  await expect(page.locator('input[name="email"]')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
});

test('shows invitation recovery guidance for an invalid token', async ({ page }) => {
  await page.goto('/invite/invalid-token?error=invalid_or_expired');

  await expect(
    page.getByRole('heading', { name: 'This invitation is no longer valid' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute(
    'href',
    '/sign-in',
  );
});

test('shows callback recovery guidance when the verification code is missing', async ({ page }) => {
  await page.goto('/auth/callback');

  await expect(page.locator('p[role="alert"]')).toHaveText(
    'Your sign-in link is incomplete. Request a new one and try again.',
  );
});

test('shows password-recovery and email-verification request forms', async ({ page }) => {
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(page.locator('input[name="email"]')).toHaveAttribute('autocomplete', 'email');

  await page.goto('/verify-email');
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.locator('input[name="email"]')).toHaveAttribute('autocomplete', 'email');
});

test('redirects a sign-out request back to sign in', async ({ request }) => {
  const response = await request.post('/auth/sign-out', { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers().location).toBe('http://localhost:3000/sign-in');
});
