// Import the unchanged source tests; retain every actual image in addition to their comparisons.
// This review harness is outside release source and must run only in the approved Linux runner.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const reviewRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(process.env.PASSWORD_SCREENSHOT_SOURCE_ROOT ||
  resolve(reviewRoot, 'password-visibility-web-candidate-oct8'));
const require = createRequire(resolve(sourceRoot, 'package.json'));
const { test } = require('@playwright/test');
const origin = process.env.PASSWORD_SCREENSHOT_ORIGIN || 'http://127.0.0.1:3112';
const { prepareVisualPage } = await import(pathToFileURL(resolve(sourceRoot, 'tests/e2e/helpers/visual.ts')));
await import(pathToFileURL(resolve(sourceRoot, 'tests/e2e/visual/auth-and-onboarding.visual.spec.ts')));

const violations = new WeakMap();
test.beforeEach(async ({ context, page }) => {
  assert.equal(process.platform, 'linux', 'Canonical review capture requires Linux.');
  assert.equal(process.arch, 'x64', 'Match the canonical Linux amd64 runner.');
  assert.equal(process.version, 'v24.12.0', 'Use the pinned Node runtime.');
  assert.equal((await context.cookies()).length, 0, 'Anonymous capture must start without cookies.');
  const unexpected = [];
  violations.set(page, unexpected);
  await context.route('**/*', async route => {
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
