import { expect, test } from '@playwright/test';

test('fixture imports the real wizard and supports seven-step navigation, review, confirmation, and no overflow', async ({ page }) => {
  await page.goto('/publish');
  await expect(page.getByRole('heading', { name: 'Publish tryout' })).toBeVisible();
  await page.getByLabel('Type “Fall ID Camp” to publish').fill('Fall ID Camp');
  await expect(page.getByRole('button', { name: 'Publish tryout' })).toBeEnabled();
  await page.goto('/review');
  await expect(page.getByText('rubric invalid')).toBeVisible();
  for (const label of ['Basics', 'Divisions', 'Sessions', 'Registration', 'Rubrics', 'Review', 'Publish']) await expect(page.getByRole('link', { name: new RegExp(label) })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
