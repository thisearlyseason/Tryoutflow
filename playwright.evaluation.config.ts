import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'mobile-evaluation.spec.ts',
  reporter: 'line',
  workers: 1,
  timeout: 30_000,
  webServer: {
    command:
      'npm exec -- next dev tests/fixtures/evaluation --webpack --hostname 127.0.0.1 --port 3103',
    url: 'http://127.0.0.1:3103',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3103' },
  projects: [
    { name: 'Mobile Chrome', use: devices['Pixel 7'] },
    { name: 'Mobile Safari', use: devices['iPhone 15'] },
  ],
});
