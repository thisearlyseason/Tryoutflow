import { expect, test } from '@playwright/test';

test('shows the organization onboarding form', async ({ page }) => {
  await page.goto('/start');
  await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
  await expect(page.getByLabel('Organization URL')).toBeVisible();
});

test('protects a direct organization URL when no session is present', async ({ page }) => {
  await page.goto('/app/badlands-hockey-academy/home');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fbadlands-hockey-academy%2Fhome/);
});
