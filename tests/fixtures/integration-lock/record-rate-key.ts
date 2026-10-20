import { createHash } from 'node:crypto';

export function recordIntegrationRateKey(key: string) {
  if (!/^[0-9a-f]{64}$/u.test(key)) throw new Error('invalid integration rate key');
  const runId = process.env.TRYOUTFLOW_INTEGRATION_RUN_ID;
  if (!runId || !/^[0-9a-f]{16}$/u.test(runId))
    throw new Error('supervised integration run id required');
  return createHash('sha256').update(`${runId}|${key}`).digest('hex');
}
