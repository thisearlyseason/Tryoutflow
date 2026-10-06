import { expect, type Cookie, type Page } from '@playwright/test';

let demoSessionCookies: Cookie[] | undefined;

export async function signInDemoOwner(page: Page) {
  if (demoSessionCookies) {
    await page.context().addCookies(demoSessionCookies);
    await page.goto('/app/badlands-hockey-academy/home');
    await expect(page).toHaveURL(/\/app\/badlands-hockey-academy\/home$/u);
    return;
  }

  const password = process.env.TRYOUTFLOW_LOCAL_DEMO_PASSWORD;
  if (!password) throw new Error('TRYOUTFLOW_LOCAL_DEMO_PASSWORD is required for demo visuals.');

  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: /^Email/ }).fill('demo.owner@badlands.example.test');
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app\/badlands-hockey-academy\/home$/u);
  demoSessionCookies = await page.context().cookies();
}

export async function openDemoTryout(page: Page) {
  const tryout = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'U15 Fall Evaluations' }),
  });
  await tryout.getByRole('link', { name: 'Open tryout' }).click();
  await expect(page).toHaveURL(/\/tryouts\/[0-9a-f-]+\/overview$/u);
}

export async function prepareVisualPage(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Background refresh/preload requests need not become idle. Require the
  // rendered surface, completed user actions, fonts, and real image decoding.
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, {
    timeout: 10_000,
  });
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;caret-color:transparent!important;transition-delay:0s!important;transition-duration:0s!important}',
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, async (image) => {
        // Full-page captures include below-the-fold assets too.
        image.loading = 'eager';
        await image.decode();
      }),
    );
  });
}

export async function expectVisual(page: Page, name: string) {
  await prepareVisualPage(page);
  // Record every mismatch while retaining failure of the complete visual gate.
  await expect.soft(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  });
}
