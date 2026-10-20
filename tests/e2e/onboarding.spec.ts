import { expect, test } from '@playwright/test';

test('shows the organization onboarding form', async ({ page }) => {
  await page.goto('/start');
  await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
  await expect(page.getByLabel('Your TryoutFlow workspace address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create organization' })).toBeVisible();
});

test('shows invitation recovery guidance without exposing organization details', async ({
  page,
}) => {
  await page.goto('/invite/short?error=invalid_or_expired');
  await expect(
    page.getByRole('heading', { name: 'This invitation is no longer valid' }),
  ).toBeVisible();
  await expect(page.getByText(/ask an administrator to send a new invitation/i)).toBeVisible();
  await expect(page.getByText('Badlands Hockey Academy')).toHaveCount(0);
});

test('protects a direct organization URL when no session is present', async ({ page }) => {
  await page.goto('/app/badlands-hockey-academy/home');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fbadlands-hockey-academy%2Fhome/);
});
