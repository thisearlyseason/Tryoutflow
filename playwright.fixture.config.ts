import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'tryout-wizard-fixture.spec.ts',
  webServer: {
    command: 'npx next dev tests/fixtures/wizard --hostname 127.0.0.1 --port 3101',
    url: 'http://127.0.0.1:3101',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3101' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'Mobile Safari', use: devices['iPhone 15'] },
  ],
});
