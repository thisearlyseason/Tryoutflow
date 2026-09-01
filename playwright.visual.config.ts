import { execFileSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';
import { z } from 'zod';

const localStatus = z.record(z.string(), z.unknown()).parse(
  JSON.parse(
    execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
    }),
  ) as unknown,
);
const local = z
  .strictObject({
    API_URL: z.url(),
    PUBLISHABLE_KEY: z.string().min(1),
    SERVICE_ROLE_KEY: z.string().min(1),
  })
  .parse({
    API_URL: localStatus.API_URL,
    PUBLISHABLE_KEY: localStatus.PUBLISHABLE_KEY,
    SERVICE_ROLE_KEY: localStatus.SECRET_KEY ?? localStatus.SERVICE_ROLE_KEY,
  });
const port = 3112;
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e/visual',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', maxDiffPixels: 120 } },
  outputDir: 'output/playwright/visual-results',
  reporter: [['line']],
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{projectName}/{arg}{ext}',
  webServer: {
    command: `corepack npm run build && corepack npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: `${origin}/sign-in`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
      NEXT_PUBLIC_APP_URL: 'https://task30.e2e.example.test',
      TRYOUTFLOW_BOT_PROTECTION_MODE: 'deterministic-test',
      TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
      TASK30_LOCAL_REQUEST_ORIGIN: origin,
      ABUSE_PROTECTION_HMAC_SECRET: 'visual-abuse-protection-secret'.padEnd(64, 'a'),
      PUBLIC_REGISTRATION_RATE_LIMIT_SECRET: 'visual-rate-limit-secret'.padEnd(64, 'r'),
    },
  },
  use: {
    baseURL: origin,
    colorScheme: 'light',
    locale: 'en-CA',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } },
    },
    {
      name: 'mobile-chromium',
      testIgnore: [
        'application-shell.visual.spec.ts',
        'decisions.visual.spec.ts',
        'tryout-administration.visual.spec.ts',
      ],
      use: { ...devices['Pixel 7'] },
    },
  ],
});
