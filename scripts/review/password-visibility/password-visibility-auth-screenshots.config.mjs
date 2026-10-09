// External review config: never import playwright.visual.config.ts (it runs Supabase status).
// Collection is authorized; Linux capture requires the resource owner and coordinator to proceed.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const reviewRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(
  process.env.PASSWORD_SCREENSHOT_SOURCE_ROOT ||
    resolve(reviewRoot, 'password-visibility-web-candidate-oct8'),
);
const require = createRequire(resolve(sourceRoot, 'package.json'));
const { defineConfig, devices } = require('@playwright/test');
if (require('@playwright/test/package.json').version !== '1.62.1') {
  throw new Error('Screenshot review requires the exact project Playwright 1.62.1.');
}
const origin = process.env.PASSWORD_SCREENSHOT_ORIGIN || 'http://127.0.0.1:3112';
const jsonReport = process.env.PASSWORD_SCREENSHOT_JSON_REPORT;
const wrapperPath = resolve(reviewRoot, 'password-visibility-auth-review.capture.spec.mjs');
const wrapperMatch = new RegExp('^' + wrapperPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
const parsedOrigin = new URL(origin);
if (
  parsedOrigin.hostname !== '127.0.0.1' ||
  parsedOrigin.protocol !== 'http:' ||
  parsedOrigin.port !== '3112' ||
  parsedOrigin.pathname !== '/' ||
  parsedOrigin.search ||
  parsedOrigin.hash ||
  parsedOrigin.username ||
  parsedOrigin.password
) {
  throw new Error('Use the isolated runner owned loopback origin http://127.0.0.1:3112.');
}

export default defineConfig({
  testDir: reviewRoot,
  testMatch: wrapperMatch,
  grep: /\/(?:sign-in|sign-up) uses the Performance Lab shell$|shared password visibility$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', maxDiffPixels: 120 } },
  outputDir: resolve(
    process.env.PASSWORD_SCREENSHOT_OUTPUT ||
      resolve(reviewRoot, 'password-visibility-linux-auth-artifacts'),
  ),
  reporter: [['line'], ...(jsonReport ? [['json', { outputFile: resolve(jsonReport) }]] : [])],
  snapshotPathTemplate: resolve(
    sourceRoot,
    'tests/e2e/visual/__snapshots__/auth-and-onboarding.visual.spec.ts/{projectName}/{arg}{ext}',
  ),
  updateSnapshots: 'none',
  use: {
    baseURL: origin,
    colorScheme: 'light',
    locale: 'en-CA',
    screenshot: 'only-on-failure',
    timezoneId: 'America/Edmonton',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
