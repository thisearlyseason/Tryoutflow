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

test('owner sees bounded Game-Day check-in and live operations', async ({ page }) => {
  await signInDemoOwner(page);
  await page.goto('/app/badlands-hockey-academy/tryouts');
  await page.getByRole('link', { name: 'U15 Fall Evaluations' }).click();
  await expect(page.getByRole('list', { name: 'Tryout lifecycle' })).toBeVisible();
  const overviewUrl = page.url();

  await page.goto(overviewUrl.replace('/overview', '/check-in'));
  await expect(page.getByRole('heading', { name: /check-in$/ })).toBeVisible();
  await expect(page.locator('.theme-game-day').getByRole('search')).toBeVisible();
  await page.getByLabel('Search registrations').fill('Avery');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Avery Synthetic' })).toBeVisible();
  await expect(page).toHaveScreenshot('game-day-check-in.png', { fullPage: true });

  await page.goto(overviewUrl.replace('/overview', '/live'));
  await expect(page.getByRole('heading', { name: 'Live dashboard' })).toBeVisible();
  await expect(page.locator('.theme-game-day')).toBeVisible();
  await expect(page).toHaveScreenshot('game-day-live-dashboard.png', { fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('game-day-live-dashboard-mobile.png', { fullPage: true });
});
