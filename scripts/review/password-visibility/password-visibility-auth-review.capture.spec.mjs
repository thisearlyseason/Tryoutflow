// Import the unchanged source tests; retain every actual image in addition to their comparisons.
// This review harness is outside release source and must run only in the approved Linux runner.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const reviewRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(
  process.env.PASSWORD_SCREENSHOT_SOURCE_ROOT ||
    resolve(reviewRoot, 'password-visibility-web-candidate-oct8'),
);
const require = createRequire(resolve(sourceRoot, 'package.json'));
const { test, expect } = require('@playwright/test');
const origin = process.env.PASSWORD_SCREENSHOT_ORIGIN || 'http://127.0.0.1:3112';
const { prepareVisualPage } = await import(
  pathToFileURL(resolve(sourceRoot, 'tests/e2e/helpers/visual.ts'))
);
await import(
  pathToFileURL(resolve(sourceRoot, 'tests/e2e/visual/auth-and-onboarding.visual.spec.ts'))
);

const violations = new WeakMap();
test.beforeEach(async ({ context, page }) => {
  assert.equal(process.platform, 'linux', 'Canonical review capture requires Linux.');
  assert.equal(process.arch, 'x64', 'Match the canonical Linux amd64 runner.');
  assert.equal(process.version, 'v24.12.0', 'Use the pinned Node runtime.');
  assert.equal(
    (await context.cookies()).length,
    0,
    'Anonymous capture must start without cookies.',
  );
  const unexpected = [];
  violations.set(page, unexpected);
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      // Retain only method/origin; never query strings, headers, bodies or credential values.
      unexpected.push({ method: request.method(), origin: new URL(request.url()).origin });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
});

test.afterEach(async ({ page }, testInfo) => {
  try {
    if (!page.isClosed()) {
      await prepareVisualPage(page);
      await page.screenshot({
        path: testInfo.outputPath('actual-full-page-review.png'),
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        scale: 'css',
      });
      await testInfo.attach('actual-full-page-review', {
        path: testInfo.outputPath('actual-full-page-review.png'),
        contentType: 'image/png',
      });
    }
  } finally {
    assert.deepEqual(violations.get(page) || [], [], 'Unexpected mutation or external request.');
  }
});

for (const route of ['/reset-password', '/sign-up?purpose=participant']) {
  test(`${route} shared password visibility`, async ({ page }, testInfo) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      route === '/reset-password' ? 'Choose a new password' : 'Create your participant account',
    );
    const password = page.locator('#password');
    const confirmation = page.locator('#confirmPassword');
    const showPassword = page.getByRole('button', { name: 'Show password', exact: true });
    const showConfirmation = page.getByRole('button', {
      name: 'Show confirm password',
      exact: true,
    });
    await expect(password).toHaveAttribute('type', 'password');
    await expect(confirmation).toHaveAttribute('type', 'password');
    await expect(showPassword).toBeEnabled();
    await expect(showConfirmation).toBeEnabled();
    for (const field of [password, confirmation]) {
      await expect(field).toHaveAttribute('autocomplete', 'new-password');
      await expect(field).toHaveAttribute('minlength', '8');
      await expect(field).toHaveAttribute('maxlength', '128');
    }
    await page.evaluate(() => {
      window.__sharedOriginalInputs = [
        document.querySelector('#password'),
        document.querySelector('#confirmPassword'),
      ];
      window.__sharedSubmitCount = 0;
      document.querySelector('form').addEventListener('submit', () => {
        window.__sharedSubmitCount++;
      });
    });
    async function checkGeometry() {
      const rows = await page.evaluate(() =>
        ['password', 'confirmPassword'].map((id) => {
          const input = document.getElementById(id);
          const button = input.parentElement.querySelector('button');
          const a = input.getBoundingClientRect();
          const b = button.getBoundingClientRect();
          return {
            inputWidth: a.width,
            buttonWidth: b.width,
            buttonHeight: b.height,
            gap: b.left - a.right,
            right: b.right,
            viewport: innerWidth,
          };
        }),
      );
      for (const row of rows) {
        expect(row.inputWidth).toBeGreaterThanOrEqual(44);
        expect(row.buttonWidth).toBeGreaterThanOrEqual(44);
        expect(row.buttonHeight).toBeGreaterThanOrEqual(44);
        expect(row.gap).toBeGreaterThanOrEqual(7);
        expect(row.right).toBeLessThanOrEqual(row.viewport);
      }
    }
    async function capture(name) {
      await prepareVisualPage(page);
      await checkGeometry();
      const path = testInfo.outputPath(name + '.png');
      await page.screenshot({
        path,
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        scale: 'css',
      });
      await testInfo.attach(name, { path, contentType: 'image/png' });
    }
    await capture('shared-initial-masked');
    // Public synthetic values only; no submission, account or backend operation.
    await password.fill('DemoPass1!');
    await confirmation.fill('DemoPass1!');
    await showPassword.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(confirmation).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await showConfirmation.focus();
    await showConfirmation.press('Enter');
    await expect(confirmation).toHaveAttribute('type', 'text');
    await capture('shared-revealed');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    await page.getByRole('button', { name: 'Hide confirm password', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(confirmation).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue('DemoPass1!');
    await expect(confirmation).toHaveValue('DemoPass1!');
    expect(
      await page.evaluate(() => ({
        sameNodes:
          window.__sharedOriginalInputs[0] === document.querySelector('#password') &&
          window.__sharedOriginalInputs[1] === document.querySelector('#confirmPassword'),
        submissions: window.__sharedSubmitCount,
        password: new FormData(document.querySelector('form')).get('password'),
        confirmation: new FormData(document.querySelector('form')).get('confirmPassword'),
      })),
    ).toEqual({
      sameNodes: true,
      submissions: 0,
      password: 'DemoPass1!',
      confirmation: 'DemoPass1!',
    });
    await capture('shared-remasked');
  });
}
