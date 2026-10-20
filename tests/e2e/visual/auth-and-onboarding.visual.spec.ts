import { expect, test } from '@playwright/test';

import { expectVisual } from '../helpers/visual';

for (const route of ['/sign-in', '/sign-up', '/forgot-password', '/verify-email']) {
  test(`${route} uses the Performance Lab shell`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('region', { name: 'TryoutFlow product summary' })).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expectVisual(page, `${route.slice(1)}.png`);
  });
}
