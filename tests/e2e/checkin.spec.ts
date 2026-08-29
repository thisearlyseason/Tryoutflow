import { expect, test } from '@playwright/test';

test('check-in workspace supports search, placement, conflict recovery, and mobile layout', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fall ID Camp check-in' })).toBeVisible();
  await page.getByLabel('Search registrations').fill('Ava');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: 'Ava Smith' })).toBeVisible();
  await expect(page.getByText(/Taylor Smith/)).toBeVisible();
  await page.getByLabel('Session and group').selectOption('1');
  await page.getByLabel('Requested number (optional)').fill('42');
  await page.getByRole('button', { name: 'Check in Ava Smith' }).click();
  await expect(page.getByRole('status')).toContainText('Try #43');
  await page.getByLabel('Requested number (optional)').fill('43');
  await page.getByRole('button', { name: 'Check in Ava Smith' }).click();
  await expect(page.getByRole('status')).toContainText('Ava Smith checked in');
  await expect(page.getByRole('button', { name: 'Confirm Ava Smith again' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm Ava Smith again' }).click();
  await expect(page.getByRole('status')).toContainText('Ava Smith was already checked in. #43');
  const targets = await page.locator('main button, main input, main select').evaluateAll((nodes) =>
    nodes.map((node) => ({
      height: node.getBoundingClientRect().height,
      width: node.getBoundingClientRect().width,
    })),
  );
  expect(
    targets.every((target) => target.height >= 43.9),
    JSON.stringify(targets),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.locator('body')).not.toContainText(/score|ranking|rubric|notes/i);
});
