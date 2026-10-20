import { execFileSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';

const local = JSON.parse(
  execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }),
) as {
  API_URL: string;
  DB_URL: string;
  PUBLISHABLE_KEY: string;
  SECRET_KEY?: string;
  SERVICE_ROLE_KEY: string;
};

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'production-roster-export.spec.ts',
  reporter: 'line',
  workers: 1,
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3110',
    url: 'http://127.0.0.1:3110/sign-in',
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3110',
      SUPABASE_SERVICE_ROLE_KEY: local.SECRET_KEY ?? local.SERVICE_ROLE_KEY,
      PUBLIC_REGISTRATION_RATE_LIMIT_SECRET: 'task27-browser-rate-limit-secret'.padEnd(64, 'x'),
      ENABLE_MOCK_THE_SQUAD_PROVIDER: 'true',
      JOB_PROCESSOR_CRON_SECRET: 'task27-browser-job-secret'.padEnd(40, 'x'),
      RESEND_API_KEY: 're_task27_browser_dummy_key',
      RESEND_FROM_EMAIL: 'browser@example.test',
    },
  },
  use: { baseURL: 'http://127.0.0.1:3110', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'Mobile Chrome', use: devices['Pixel 7'] },
  ],
});
