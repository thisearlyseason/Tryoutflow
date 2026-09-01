import { expect, test } from '@playwright/test';

import { expectVisual, signInDemoOwner } from '../helpers/visual';

test('owner sees unified organization administration', async ({ page }) => {
  await signInDemoOwner(page);

  await page.goto('/app/badlands-hockey-academy/organization/members');
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByTestId('invite-member-form')).toBeVisible();
  await expectVisual(page, 'members-administration.png');

  await page.goto('/app/badlands-hockey-academy/organization/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await expect(page.locator('.integration-card')).toBeVisible();
  await expectVisual(page, 'integrations-administration.png');

  await page.goto('/app/badlands-hockey-academy/organization/billing');
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  await expect(page.locator('.plan-card').first()).toBeVisible();
  await expectVisual(page, 'billing-administration.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectVisual(page, 'billing-administration-mobile.png');
});
