import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('previews and confirms the exact audience without changing decisions', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Decision messages', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Preview exact recipients' }).click();
  await expect(page.getByRole('heading', { name: 'Exact recipient preview · 2' })).toBeVisible();
  await expect(page.getByText('ava@example.com')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /guardian|evaluator|score|private response/i,
  );
  await expect(page.getByText('Exact rendered message')).toBeVisible();
  await page.getByText('Ava · ava@example.com', { exact: true }).click();
  await expect(page.getByText(/Subject: Roster selection/u).first()).toBeVisible();
  await page.getByText('Bea · bea@example.com', { exact: true }).click();
  await expect(page.getByText(/Bea\s+Thank you for taking part/u)).toBeVisible();
  await expect(
    page
      .getByTitle('HTML message preview for Bea')
      .contentFrame()
      .getByText('Bea later-recipient HTML'),
  ).toBeVisible();
  await expect(page.getByText(/<main><p>Bea later-recipient HTML<\/p><\/main>/u)).toBeVisible();
  await page.getByLabel('Type SEND EXACT BATCH to confirm').fill('SEND EXACT BATCH');
  await page.getByRole('button', { name: 'Confirm and queue exactly 2' }).click();
  await expect(page.getByRole('status')).toContainText(
    '2 messages queued. Decisions were not changed.',
  );
  await expect(page.getByText('Current finalized decision: Selected')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});

test('fails stale snapshots closed and has 44px controls without 320px overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await page.getByLabel('Decision').selectOption('released');
  await page.getByRole('button', { name: 'Preview exact recipients' }).click();
  await expect(page.getByRole('status')).toContainText('finalized roster changed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const heights = await page
    .locator('main')
    .locator('button, select, textarea')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).offsetParent !== null)
        .map((node) => node.getBoundingClientRect().height),
    );
  expect(
    heights.every((height) => height >= 43.9),
    JSON.stringify(heights),
  ).toBe(true);
});
