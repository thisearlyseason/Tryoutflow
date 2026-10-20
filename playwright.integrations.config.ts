import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'mock-roster-export.spec.ts',
  reporter: 'line',
  workers: 1,
  webServer: {
    command:
      'npm exec -- next dev tests/fixtures/integrations --webpack --hostname 127.0.0.1 --port 3107',
    url: 'http://127.0.0.1:3107',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3107', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'Mobile Chrome', use: devices['Pixel 7'] },
  ],
});
