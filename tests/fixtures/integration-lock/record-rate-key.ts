import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export function recordIntegrationRateKey(key: string) {
  if (!/^[0-9a-f]{64}$/u.test(key)) throw new Error('invalid integration rate key');
  const runId = process.env.TRYOUTFLOW_INTEGRATION_RUN_ID;
  const log = process.env.TRYOUTFLOW_INTEGRATION_RATE_KEY_LOG;
  if (!runId || !/^[0-9a-f]{16}$/u.test(runId) || !log || basename(log) !== `${runId}.rate-keys`)
    throw new Error('supervised integration rate-key log required');
  const namespacedKey = createHash('sha256').update(`${runId}|${key}`).digest('hex');
  appendFileSync(log, `v2:${namespacedKey}\n`, { mode: 0o600 });
  return namespacedKey;
}
