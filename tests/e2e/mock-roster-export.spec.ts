import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('reviews an explicit demo destination and fields, confirms, and retries failed items only', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Export finalized roster' })).toBeVisible();
  await expect(page.getByText(/demo\/mock only/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview export' })).toBeDisabled();
  await page.getByLabel('External destination').selectOption('mock-team');
  await page.getByLabel('First name').check();
  await page.getByLabel('Last name').check();
  await page.getByLabel('Team name').check();
  await page.getByRole('button', { name: 'Preview export' }).click();
  await expect(page.getByRole('heading', { name: 'Review 2 athletes' })).toBeVisible();
  await expect(page.getByText(/only the approved fields/i)).toBeVisible();
  await page.getByLabel('I reviewed the exact destination and fields').check();
  await page.getByRole('button', { name: 'Confirm and queue export' }).click();
  await expect(page.getByText(/export queued/i)).toBeVisible();
  await page.getByRole('button', { name: 'Retry 1 failed item' }).click();
  await expect(page.getByText(/completed items were preserved/i)).toBeVisible();
});

test('has no critical accessibility violations or narrow-screen overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const controls = await page
    .locator('main')
    .locator('button,select,label:has(input)')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => ({
          label: (node as HTMLElement).innerText || (node as HTMLSelectElement).value,
          height: node.getBoundingClientRect().height,
        })),
    );
  expect(
    controls.every(({ height }) => height >= 43.9),
    JSON.stringify(controls),
  ).toBe(true);
  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
});
