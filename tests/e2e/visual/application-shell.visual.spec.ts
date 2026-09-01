import { expect, test } from '@playwright/test';

test('demo owner sees the role-aware command center', async ({ page }) => {
  const password = process.env.TRYOUTFLOW_LOCAL_DEMO_PASSWORD;
  if (!password) throw new Error('TRYOUTFLOW_LOCAL_DEMO_PASSWORD is required for demo visuals.');

  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: /^Email/ }).fill('demo.owner@badlands.example.test');
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app\/badlands-hockey-academy\/home$/u);

  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  const visibleIdentity = page.locator('.mobile-organization:visible, .app-organization:visible');
  await expect(visibleIdentity.getByText('Badlands Hockey Academy')).toBeVisible();
  await expect(visibleIdentity.getByText('Owner')).toBeVisible();
  await expect(page).toHaveScreenshot('owner-command-center.png', { fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(page).toHaveScreenshot('owner-command-center-mobile.png', { fullPage: true });
});
