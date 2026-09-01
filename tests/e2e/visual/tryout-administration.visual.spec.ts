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

test('owner sees lifecycle-led tryout administration', async ({ page }) => {
  await signInDemoOwner(page);
  await page.goto('/app/badlands-hockey-academy/tryouts');
  await expect(page.getByRole('heading', { name: 'Tryouts' })).toBeVisible();
  await expect(page).toHaveScreenshot('tryout-list.png', { fullPage: true });

  await page.getByRole('link', { name: 'U15 Fall Evaluations' }).click();
  await expect(page.getByRole('list', { name: 'Tryout lifecycle' })).toBeVisible();
  await expect(page).toHaveScreenshot('published-tryout-overview.png', { fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('published-tryout-overview-mobile.png', { fullPage: true });
});

test('closed public registration uses the branded non-oracular shell', async ({ page }) => {
  await page.goto('/register/badlands-u15-fall-2026');
  await expect(page.getByRole('heading', { name: 'Registration unavailable' })).toBeVisible();
  await expect(page).toHaveScreenshot('public-registration-unavailable.png', { fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('public-registration-unavailable-mobile.png', {
    fullPage: true,
  });
});
