import { expect, test } from '@playwright/test';

import { expectVisual, openDemoTryout, signInDemoOwner } from '../helpers/visual';

test('owner sees an evidence-first rankings and roster workspace', async ({ page }) => {
  await signInDemoOwner(page);
  await page.goto('/app/badlands-hockey-academy/tryouts');
  await openDemoTryout(page);

  await page.goto(page.url().replace('/overview', '/rankings'));
  await expect(page.getByRole('heading', { name: 'Rankings' })).toBeVisible();
  await expect(page.locator('.ranking-card').first()).toBeVisible();
  await expectVisual(page, 'rankings-decision-board.png');

  await page.goto(page.url().replace('/rankings', '/rosters'));
  await expect(page.getByText('Decision room')).toBeVisible();
  await expect(page.getByRole('heading', { name: /rosters$/ })).toBeVisible();
  await expectVisual(page, 'roster-decision-room.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectVisual(page, 'roster-decision-room-mobile.png');
});
