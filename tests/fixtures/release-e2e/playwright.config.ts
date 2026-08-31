import { defineConfig } from '@playwright/test';

export default defineConfig({
  outputDir: process.env.TRYOUTFLOW_RELEASE_RETRY_OUTPUT,
  testDir: '.',
  testMatch: 'retry-contract.spec.ts',
  projects: [{ name: 'release-retry-contract' }],
  reporter: 'json',
  retries: 1,
  workers: 1,
});
