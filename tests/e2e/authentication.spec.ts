import { expect, test } from '@playwright/test';

test('shows the password sign-in form', async ({ page }) => {
  await page.goto('/sign-in');

  await expect(page.getByRole('heading', { name: 'Sign in to your organization' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email');
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
