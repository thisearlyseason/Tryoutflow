import { expect, test } from '@playwright/test';

import { expectVisual, signInDemoOwner } from '../helpers/visual';

test('owner sees lifecycle-led tryout administration', async ({ page }) => {
  await signInDemoOwner(page);
  await page.goto('/app/badlands-hockey-academy/tryouts');
  await expect(page.getByRole('heading', { name: 'Tryouts' })).toBeVisible();
  await expectVisual(page, 'tryout-list.png');

  await page.getByRole('link', { name: 'U15 Fall Evaluations' }).click();
  await expect(page.getByRole('list', { name: 'Tryout lifecycle' })).toBeVisible();
  await expectVisual(page, 'published-tryout-overview.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectVisual(page, 'published-tryout-overview-mobile.png');
});

test('closed public registration uses the branded non-oracular shell', async ({ page }) => {
  await page.goto('/register/badlands-u15-fall-2026');
  await expect(page.getByRole('heading', { name: 'Registration unavailable' })).toBeVisible();
  await expectVisual(page, 'public-registration-unavailable.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectVisual(page, 'public-registration-unavailable-mobile.png');
});
