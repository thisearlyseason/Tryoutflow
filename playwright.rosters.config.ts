import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'roster-finalization.spec.ts',
  reporter: 'line',
  workers: 1,
  timeout: 30_000,
  webServer: {
    command:
      'npm exec -- next dev tests/fixtures/rosters --webpack --hostname 127.0.0.1 --port 3105',
    url: 'http://127.0.0.1:3105',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3105' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
    { name: 'Mobile Chrome', use: devices['Pixel 5'] },
    { name: 'Mobile Safari', use: devices['iPhone 13'] },
  ],
});
