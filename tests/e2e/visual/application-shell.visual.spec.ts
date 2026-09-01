import { expect, test } from '@playwright/test';

import { expectVisual, signInDemoOwner } from '../helpers/visual';

test('demo owner sees the role-aware command center', async ({ page }) => {
  await signInDemoOwner(page);

  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  const visibleIdentity = page.locator('.mobile-organization:visible, .app-organization:visible');
  await expect(visibleIdentity.getByText('Badlands Hockey Academy')).toBeVisible();
  await expect(visibleIdentity.getByText('Owner')).toBeVisible();
  await expectVisual(page, 'owner-command-center.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expectVisual(page, 'owner-command-center-mobile.png');
});
