import { expect, test } from '@playwright/test';

async function signInDemoOwner(page: import('@playwright/test').Page) {
  const password = process.env.TRYOUTFLOW_LOCAL_DEMO_PASSWORD;
  if (!password) throw new Error('TRYOUTFLOW_LOCAL_DEMO_PASSWORD is required for demo visuals.');
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: /^Email/ }).fill('demo.owner@badlands.example.test');
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app\/badlands-hockey-academy\/home$/u);
}

test('owner sees unified organization administration', async ({ page }) => {
  await signInDemoOwner(page);

  await page.goto('/app/badlands-hockey-academy/organization/members');
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByTestId('invite-member-form')).toBeVisible();
  await expect(page).toHaveScreenshot('members-administration.png', { fullPage: true });

  await page.goto('/app/badlands-hockey-academy/organization/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await expect(page.locator('.integration-card')).toBeVisible();
  await expect(page).toHaveScreenshot('integrations-administration.png', { fullPage: true });

  await page.goto('/app/badlands-hockey-academy/organization/billing');
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.locator('.plan-card').first()).toBeVisible();
  await expect(page).toHaveScreenshot('billing-administration.png', { fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('billing-administration-mobile.png', { fullPage: true });
});
