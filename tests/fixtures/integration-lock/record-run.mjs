import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [output, holdMillisecondsText, counterKey] = process.argv.slice(2);
if (!output || !holdMillisecondsText || !counterKey) {
  throw new Error('output path, hold duration, and counter key are required');
}
const holdMilliseconds = Number.parseInt(holdMillisecondsText, 10);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const existing = execFileSync(
  'psql',
  [
    '-X',
    '-At',
    databaseUrl,
    '-c',
    `select count(*) from public.registration_rate_counters where key_hash='${counterKey}'`,
  ],
  { encoding: 'utf8' },
).trim();
if (existing !== '0') throw new Error('integration command inherited rate-counter fixture state');
execFileSync(
  'psql',
  [
    '-X',
    '-At',
    databaseUrl,
    '-c',
    `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${counterKey}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
  ],
  { stdio: 'pipe' },
);
appendFileSync(output, `${JSON.stringify({ event: 'start', pid: process.pid })}\n`);
await new Promise((resolve) => setTimeout(resolve, holdMilliseconds));
appendFileSync(output, `${JSON.stringify({ event: 'end', pid: process.pid })}\n`);
