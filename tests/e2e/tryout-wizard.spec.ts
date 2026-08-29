import { expect, test } from '@playwright/test';

test('renders a focused publish step without horizontal overflow on desktop and mobile', async ({
  page,
}) => {
  await page.goto('/wizard-test-harness/publish');
  await expect(page.getByRole('heading', { name: 'Publish tryout' })).toBeVisible();
  const publish = page.getByRole('button', { name: 'Publish tryout' });
  await expect(publish).toBeDisabled();
  await page.getByLabel('Type “Fall ID Camp” to publish').fill('Fall ID Camp');
  await expect(publish).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('shows blockers in the review summary', async ({ page }) => {
  await page.goto('/wizard-test-harness/review');
  await expect(page.getByRole('heading', { name: 'Review setup' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Publishing is blocked' })).toBeVisible();
  await expect(page.getByText('rubric invalid')).toBeVisible();
});
