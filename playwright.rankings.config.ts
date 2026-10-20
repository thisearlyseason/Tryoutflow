import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'rankings-and-comparison.spec.ts',
  reporter: 'line',
  workers: 1,
  timeout: 30_000,
  webServer: {
    command:
      'npm exec -- next dev tests/fixtures/rankings --webpack --hostname 127.0.0.1 --port 3104',
    url: 'http://127.0.0.1:3104',
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://127.0.0.1:3104' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
  ],
});
