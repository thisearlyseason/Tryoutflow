import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'subscriptions.spec.ts',
  reporter: 'line',
  workers: 1,
  timeout: 30_000,
  webServer: {
    command:
      'npm exec -- next dev tests/fixtures/subscriptions --webpack --hostname 127.0.0.1 --port 3107',
    url: 'http://127.0.0.1:3107',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3107' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
    { name: 'Mobile Safari', use: devices['iPhone 13'] },
  ],
});
