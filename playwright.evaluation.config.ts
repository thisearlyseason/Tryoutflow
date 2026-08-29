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
    env: {
      ...process.env,
      NEXT_PUBLIC_EVALUATION_SNAPSHOT_PROOF_PUBLIC_JWK:
        '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256"}',
      EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK:
        '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256","d":"vDD7kT3X7_b_h5H_sUMNhi8gXMJeZ4MmSQZxJDTmjg0"}',
    },
  },
  use: { baseURL: 'http://127.0.0.1:3103' },
  projects: [
    { name: 'Mobile Chrome', use: devices['Pixel 7'] },
    { name: 'Mobile Safari', use: devices['iPhone 15'] },
  ],
});
