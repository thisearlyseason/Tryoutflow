import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'tryout-wizard-fixture.spec.ts',
  workers: 1,
  timeout: 20_000,
  webServer: {
    // The isolated fixture imports source outside its app root. Webpack keeps
    // that development compilation deterministic for the browser suite.
    command: 'npx next dev tests/fixtures/wizard --webpack --hostname 127.0.0.1 --port 3101',
    // The fixture only exposes the focused wizard routes; checking `/` would
    // wait forever on its intentional 404 before Playwright can run a test.
    url: 'http://127.0.0.1:3101/publish',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3101' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'Mobile Safari', use: devices['iPhone 15'] },
  ],
});
