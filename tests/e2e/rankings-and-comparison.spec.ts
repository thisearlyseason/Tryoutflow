import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('filters, selects, and compares ranking evidence without private-data leakage', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tryout rankings' })).toBeVisible();
  await expect(page.getByText('Tied at rank 1')).toHaveCount(2);
  await expect(page.getByLabel('Division')).toBeVisible();
  await expect(page.getByLabel('Position')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /guardian|private peer note|registration answers/i,
  );
  await page.getByLabel('Select Athlete 12 for comparison').check();
  await page.getByLabel('Select Athlete 14 for comparison').check();
  await page.getByRole('link', { name: /Compare selected/ }).click();
  await expect(page.getByRole('heading', { name: 'Athlete comparison' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Skating');
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});

test('renders denied and 320px ranking states without viewport overflow', async ({ page }) => {
  await page.goto('/forbidden');
  await expect(page.getByRole('alert')).toContainText('Rankings access denied');
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const targets = await page
    .locator('main')
    .locator('button, input:not([type="checkbox"]), select, a, label:has(input[type="checkbox"])')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => ({
          label: (node as HTMLElement).innerText || (node as HTMLInputElement).name,
          height: node.getBoundingClientRect().height,
        })),
    );
  expect(
    targets.every(({ height }) => height >= 43.9),
    JSON.stringify(targets),
  ).toBe(true);
});
