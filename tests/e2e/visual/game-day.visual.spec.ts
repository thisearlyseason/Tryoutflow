import { expect, test } from '@playwright/test';

import { expectVisual, signInDemoOwner } from '../helpers/visual';

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
  await expectVisual(page, 'game-day-check-in.png');

  await page.goto(overviewUrl.replace('/overview', '/live'));
  await expect(page.getByRole('heading', { name: 'Live dashboard' })).toBeVisible();
  await expect(page.locator('.theme-game-day')).toBeVisible();
  await expectVisual(page, 'game-day-live-dashboard.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectVisual(page, 'game-day-live-dashboard-mobile.png');
});
