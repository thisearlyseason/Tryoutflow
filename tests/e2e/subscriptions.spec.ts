import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('shows centralized plans and honest verified subscription status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
  await expect(page.getByText('$49')).toBeVisible();
  await expect(page.getByText('$129')).toBeVisible();
  await expect(page.getByText('$249')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Club plan active');
  await expect(page.getByText(/verified provider webhook/u)).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
});

test('prevents duplicate checkout clicks, reports failure, and fits 320px', async ({ page }) => {
  const attempts: string[] = [];
  await page.route('**/billing/checkout', async (route) => {
    const body = route.request().postDataJSON() as { clientAttemptId: string };
    attempts.push(body.clientAttemptId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'billing_unavailable' }),
    });
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  const chooseTeam = page.getByRole('button', { name: 'Choose Team' });
  await chooseTeam.click();
  await expect(page.getByRole('button', { name: 'Opening Team checkout…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Choose Club' })).toBeDisabled();
  await page.getByRole('button', { name: 'Opening Team checkout…' }).click({ force: true });
  await expect(page.getByText(/Checkout could not be opened/u)).toBeVisible();
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  await chooseTeam.click();
  await expect(page.getByText(/Checkout could not be opened/u)).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).not.toBe(attempts[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const heights = await page
    .locator('main button')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(
    heights.every((height) => height >= 43.9),
    JSON.stringify(heights),
  ).toBe(true);
});

test('uses a fresh portal attempt per click and never follows an unexpected host', async ({
  page,
}) => {
  const attempts: string[] = [];
  await page.route('**/billing/portal', async (route) => {
    const body = route.request().postDataJSON() as { clientAttemptId: string };
    attempts.push(body.clientAttemptId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: 'https://evil.example/p/session/trap' }),
    });
  });
  await page.goto('/');
  const manage = page.getByRole('button', { name: 'Manage billing' });
  await manage.click();
  await expect(page.getByText(/billing portal could not be opened/u)).toBeVisible();
  expect(page.url()).not.toContain('evil.example');
  await manage.click();
  await expect(page.getByText(/billing portal could not be opened/u)).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(attempts[1]).not.toBe(attempts[0]);
});
