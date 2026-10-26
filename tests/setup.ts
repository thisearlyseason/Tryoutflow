import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

process.env.NEXT_PUBLIC_EVALUATION_SNAPSHOT_PROOF_PUBLIC_JWK =
  '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256"}';
process.env.EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK =
  '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256","d":"vDD7kT3X7_b_h5H_sUMNhi8gXMJeZ4MmSQZxJDTmjg0"}';
process.env.NEXT_PUBLIC_APP_URL = 'https://tryoutflow.test';
process.env.TRYOUTFLOW_SERVER_TEST_ENV = 'vitest';
process.env.TRYOUTFLOW_BOT_PROTECTION_MODE = 'deterministic-test';
process.env.ABUSE_PROTECTION_HMAC_SECRET = 'unit-test-abuse-protection-secret'.padEnd(64, 'x');

afterEach(() => {
  cleanup();
});
