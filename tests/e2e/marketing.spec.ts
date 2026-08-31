import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const routes = [
  ['/', /stop running tryouts/i],
  ['/features', /one workflow/i],
  ['/for/teams', /one team/i],
  ['/for/clubs', /every team/i],
  ['/for/associations', /association/i],
  ['/pricing', /pricing/i],
  ['/demo', /product walkthrough/i],
  ['/privacy', /privacy/i],
  ['/terms', /terms/i],
] as const;

test.describe('indexable public marketing experience', () => {
  for (const [path, heading] of routes) {
    test(`${path} is semantic, accessible, responsive, and public`, async ({ page }) => {
      const authenticatedRequests: string[] = [];
      const consoleErrors: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) {
          authenticatedRequests.push(request.url());
        }
      });
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      await page.setViewportSize({ width: 375, height: 812 });
      const response = await page.goto(path);

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        `http://127.0.0.1:3000${path}`,
      );
      await expect(page.locator('img, picture, video, canvas')).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(authenticatedRequests).toEqual([]);
      expect(consoleErrors).toEqual([]);
      await expect(new AxeBuilder({ page }).analyze()).resolves.toMatchObject({ violations: [] });
    });
  }

  test('navigation and calls to action work without a pointer', async ({ browserName, page }) => {
    await page.goto('/');

    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    const signIn = page.getByRole('link', { name: 'Sign in' });
    await signIn.focus();
    await expect(signIn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sign-in$/u);
  });

  test('proof, pricing, and legal status stay factual', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: /tryout day workflow/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      /AI athlete selection|live The Squad|live Stripe/i,
    );

    await page.goto('/pricing');
    await expect(page.getByText('$49')).toBeVisible();
    await expect(page.getByText('$129')).toBeVisible();
    await expect(page.getByText('$249')).toBeVisible();
    await expect(page.getByText('CAD / month')).toHaveCount(3);

    for (const path of ['/privacy', '/terms']) {
      await page.goto(path);
      await expect(page.getByRole('status')).toContainText(/legal review and approval required/i);
    }
  });

  test('interactive targets stay at least 44px and motion respects user preference', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const targets = await page
      .locator('header a, header button, main a, main button, footer a, footer button')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .map((node) => ({
            name: node.textContent?.trim(),
            height: node.getBoundingClientRect().height,
            width: node.getBoundingClientRect().width,
            transitionDurationMs: (() => {
              const duration = getComputedStyle(node).transitionDuration;
              const value = Number.parseFloat(duration);
              return duration.endsWith('ms') ? value : value * 1000;
            })(),
          })),
      );
    expect(
      targets.every(({ height, width }) => height >= 43.9 && width >= 43.9),
      JSON.stringify(targets),
    ).toBe(true);
    expect(
      targets.every(({ transitionDurationMs }) => transitionDurationMs <= 0.011),
      JSON.stringify(targets),
    ).toBe(true);
  });
});
