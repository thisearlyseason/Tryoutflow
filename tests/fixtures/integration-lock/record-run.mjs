import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const [output, holdMillisecondsText, counterKey, behavior] = process.argv.slice(2);
if (!output || !holdMillisecondsText || !counterKey) {
  throw new Error('output path, hold duration, and counter key are required');
}
const holdMilliseconds = Number.parseInt(holdMillisecondsText, 10);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const runId = process.env.TRYOUTFLOW_INTEGRATION_RUN_ID;
if (!runId || !/^[0-9a-f]{16}$/u.test(runId))
  throw new Error('validated integration run id required');
const rateKeyLog = process.env.TRYOUTFLOW_INTEGRATION_RATE_KEY_LOG;
if (!rateKeyLog || !rateKeyLog.endsWith(`/${runId}.rate-keys`)) {
  throw new Error('validated integration rate-key ownership log required');
}
const namespacedCounterKey = createHash('sha256').update(`${runId}|${counterKey}`).digest('hex');
if (behavior === 'inherited-rate-state') {
  execFileSync(
    'psql',
    [
      '-X',
      '-At',
      databaseUrl,
      '-c',
      `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${namespacedCounterKey}',7,'2026-01-02 03:04:05+00','2026-01-02 03:14:05+00')`,
    ],
    { stdio: 'pipe' },
  );
  const counterSnapshot = execFileSync(
    'psql',
    [
      '-X',
      '-At',
      databaseUrl,
      '-c',
      `select row_to_json(counter)::text from public.registration_rate_counters counter where key_hash='${namespacedCounterKey}'`,
    ],
    { encoding: 'utf8' },
  ).trim();
  appendFileSync(
    output,
    `${JSON.stringify({ event: 'inherited', runId, counterKey: namespacedCounterKey, counterSnapshot })}\n`,
  );
}
const existing = execFileSync(
  'psql',
  [
    '-X',
    '-At',
    databaseUrl,
    '-c',
    `select count(*) from public.registration_rate_counters where key_hash='${namespacedCounterKey}'`,
  ],
  { encoding: 'utf8' },
).trim();
if (existing !== '0') throw new Error('integration command inherited rate-counter fixture state');
appendFileSync(rateKeyLog, `v2:${namespacedCounterKey}\n`, { mode: 0o600 });
execFileSync(
  'psql',
  [
    '-X',
    '-At',
    databaseUrl,
    '-c',
    `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${namespacedCounterKey}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
  ],
  { stdio: 'pipe' },
);
const databasePrefix = `tryoutflow_fixture_${runId}_`;
let organizationId;
let userId;
if (behavior === 'create-owned-resources') {
  organizationId = randomUUID();
  userId = randomUUID();
  execFileSync('psql', [databaseUrl, '-c', `create database ${databasePrefix}owned`], {
    stdio: 'pipe',
  });
  execFileSync(
    'psql',
    [
      databaseUrl,
      '-c',
      `insert into auth.users(id) values('${userId}'); insert into public.organizations(id,name,slug) values('${organizationId}','Owned integration fixture','owned-${runId}')`,
    ],
    { stdio: 'pipe' },
  );
}
if (behavior === 'ignore-term') process.on('SIGTERM', () => {});
appendFileSync(
  output,
  `${JSON.stringify({ event: 'start', pid: process.pid, runId, databasePrefix, organizationId, userId, counterKey: namespacedCounterKey })}\n`,
);
if (behavior === 'self-kill') process.kill(process.pid, 'SIGKILL');
if (behavior === 'exit-23') process.exit(23);
await new Promise((resolve) => setTimeout(resolve, holdMilliseconds));
appendFileSync(output, `${JSON.stringify({ event: 'end', pid: process.pid })}\n`);
