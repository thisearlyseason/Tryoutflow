import { execFileSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';
import { z } from 'zod';

import { task30RateLimitSecret } from './tests/e2e/helpers/environment';

const localSupabaseSchema = z.strictObject({
  API_URL: z.url(),
  PUBLISHABLE_KEY: z.string().min(1),
  SERVICE_ROLE_KEY: z.string().min(1),
});

const rawLocal = z
  .record(z.string(), z.unknown())
  .parse(
    JSON.parse(
      execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], { encoding: 'utf8' }),
    ) as unknown,
  );
const local = localSupabaseSchema.parse({
  API_URL: rawLocal.API_URL,
  PUBLISHABLE_KEY: rawLocal.PUBLISHABLE_KEY,
  SERVICE_ROLE_KEY: rawLocal.SERVICE_ROLE_KEY,
});
const port = 3112;
const origin = `http://127.0.0.1:${port}`;
const publicSnapshotKey =
  '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256"}';
const privateSnapshotKey =
  '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256","d":"vDD7kT3X7_b_h5H_sUMNhi8gXMJeZ4MmSQZxJDTmjg0"}';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'critical-lifecycle.spec.ts',
    'role-denials.spec.ts',
    'concurrency-and-replay.spec.ts',
    'responsive-and-accessibility.spec.ts',
  ],
  globalSetup: './tests/e2e/global-database-lifecycle.ts',
  globalTeardown: './tests/e2e/global-database-lifecycle.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: 'output/playwright/test-results',
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
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
      TASK30_LOCAL_REQUEST_ORIGIN: origin,
      PUBLIC_REGISTRATION_RATE_LIMIT_SECRET: task30RateLimitSecret,
      NEXT_PUBLIC_EVALUATION_SNAPSHOT_PROOF_PUBLIC_JWK: publicSnapshotKey,
      EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK: privateSnapshotKey,
      ENABLE_MOCK_THE_SQUAD_PROVIDER: 'true',
      MOCK_THE_SQUAD_FIXTURE: 'partial-failure',
      MOCK_THE_SQUAD_DYNAMIC_ROSTER: 'true',
      TRYOUTFLOW_FAKE_BILLING_PROVIDER: 'true',
      TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
      STRIPE_SECRET_KEY: `sk_test_${'x'.repeat(32)}`,
      STRIPE_WEBHOOK_SECRET: 'whsec_task30_local_contract_secret',
      STRIPE_PRICE_TEAM: 'price_Task30Team',
      STRIPE_PRICE_CLUB: 'price_Task30Club',
      STRIPE_PRICE_ASSOCIATION: 'price_Task30Association',
      JOB_PROCESSOR_CRON_SECRET: 'task30-local-job-secret'.padEnd(40, 'j'),
      RESEND_API_KEY: 're_task30_local_contract_only',
      RESEND_FROM_EMAIL: 'task30@example.test',
    },
  },
  use: {
    baseURL: origin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'en-CA',
        timezoneId: 'America/Edmonton',
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        locale: 'en-US',
        timezoneId: 'America/Toronto',
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], locale: 'en-GB', timezoneId: 'UTC' },
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 7'],
        locale: 'en-CA',
        timezoneId: 'America/Vancouver',
      },
    },
    {
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 15'],
        locale: 'fr-CA',
        timezoneId: 'America/Halifax',
      },
    },
  ],
});
