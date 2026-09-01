import { expect, test } from '@playwright/test';

async function signInDemoOwner(page: import('@playwright/test').Page) {
  const password = process.env.TRYOUTFLOW_LOCAL_DEMO_PASSWORD;
  if (!password) throw new Error('TRYOUTFLOW_LOCAL_DEMO_PASSWORD is required for demo visuals.');
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: /^Email/ }).fill('demo.owner@badlands.example.test');
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app\/badlands-hockey-academy\/home$/u);
}

test('owner sees an evidence-first rankings and roster workspace', async ({ page }) => {
  await signInDemoOwner(page);
  await page.goto('/app/badlands-hockey-academy/tryouts');
  await page.getByRole('link', { name: 'U15 Fall Evaluations' }).click();

  await page.getByRole('link', { name: 'Rankings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rankings' })).toBeVisible();
  await expect(page.locator('.ranking-card').first()).toBeVisible();
  await expect(page).toHaveScreenshot('rankings-decision-board.png', { fullPage: true });

  await page.goto(page.url().replace('/rankings', '/rosters'));
  await expect(page.getByText('Decision room')).toBeVisible();
  await expect(page.getByRole('heading', { name: /rosters$/ })).toBeVisible();
  await expect(page).toHaveScreenshot('roster-decision-room.png', { fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('roster-decision-room-mobile.png', { fullPage: true });
});
