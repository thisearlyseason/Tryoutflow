import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'checkin.spec.ts',
  workers: 1,
  timeout: 20_000,
  webServer: {
    command: 'npx next dev tests/fixtures/checkin --webpack --hostname 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3102' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'Mobile Safari', use: devices['iPhone 15'] },
  ],
});
