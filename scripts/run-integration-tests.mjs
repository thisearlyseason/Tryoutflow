import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const applicationPrefix = 'tryoutflow-integration-lock:';

function processFingerprint(pid) {
  try {
    const identity = execFileSync('ps', ['-p', String(pid), '-o', 'state=', '-o', 'lstart='], {
      encoding: 'utf8',
    }).trim();
    const parsed = /^(\S+)\s+(.+)$/u.exec(identity);
    if (!parsed || parsed[1].startsWith('Z')) return null;
    return createHash('sha256').update(parsed[2]).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function terminateProcessGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // The launcher may not be its process-group leader on every host.
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // The previous launcher is already gone.
  }
}

function reclaimStaleLockSessions() {
  const rows = execFileSync(
    'psql',
    [
      '-X',
      '-At',
      databaseUrl,
      '-F',
      '|',
      '-c',
      `select pid,application_name from pg_stat_activity where application_name like '${applicationPrefix}%'`,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const row of rows) {
    const separator = row.indexOf('|');
    const backendPid = Number.parseInt(row.slice(0, separator), 10);
    const [, ownerPidText, fingerprint, childPidText] = row.slice(separator + 1).split(':');
    const ownerPid = Number.parseInt(ownerPidText ?? '', 10);
    const childPid = Number.parseInt(childPidText ?? '', 10);
    if (processFingerprint(ownerPid) === fingerprint) continue;
    terminateProcessGroup(childPid);
    execFileSync(
      'psql',
      ['-X', '-At', databaseUrl, '-c', `select pg_terminate_backend(${backendPid})`],
      { stdio: 'pipe' },
    );
  }
}

function commandToRun() {
  if (process.env.TRYOUTFLOW_INTEGRATION_TEST_COMMAND) {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('integration test command override is test-only');
    }
    const parsed = JSON.parse(process.env.TRYOUTFLOW_INTEGRATION_TEST_COMMAND);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
      throw new Error('integration test command override must be a string array');
    }
    return parsed;
  }
  return [
    process.execPath,
    resolve('node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'vitest.integration.config.ts',
    'tests/integration',
    ...process.argv.slice(2),
  ];
}

function clearIntegrationEphemeralState() {
  execFileSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      databaseUrl,
      '-c',
      'delete from public.registration_rate_counters',
    ],
    { stdio: 'pipe' },
  );
}

reclaimStaleLockSessions();
const ownerFingerprint = processFingerprint(process.pid);
if (!ownerFingerprint) throw new Error('could not identify integration runner process');
const launcher = spawn(
  process.execPath,
  [resolve('scripts/lib/run-when-ready.mjs'), JSON.stringify(commandToRun()), String(process.pid)],
  { stdio: ['pipe', 'inherit', 'inherit'], detached: true },
);
const lockKey = BigInt.asIntN(
  64,
  createHash('sha256').update(databaseUrl).digest().readBigUInt64BE(0),
);
const marker = `lock-acquired-${randomUUID()}`;
const holder = spawn('psql', ['-X', '-qAt', databaseUrl], {
  env: {
    ...process.env,
    PGAPPNAME: `${applicationPrefix}${process.pid}:${ownerFingerprint}:${launcher.pid}`,
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let signalExitCode = null;
const stop = (signal, exitCode) => {
  signalExitCode = exitCode;
  try {
    process.kill(-launcher.pid, signal);
  } catch {
    // The command already exited.
  }
  holder.kill(signal);
};
process.once('SIGINT', () => stop('SIGINT', 130));
process.once('SIGTERM', () => stop('SIGTERM', 143));
let holderOutput = '';
const holderClosed = new Promise((resolveClose) => holder.once('close', resolveClose));
const acquired = new Promise((resolveAcquired, reject) => {
  holder.stdout.setEncoding('utf8').on('data', (chunk) => {
    holderOutput += chunk;
    if (holderOutput.includes(marker)) resolveAcquired();
  });
  holder.once('error', reject);
  holder.once('close', (code) => {
    if (!holderOutput.includes(marker))
      reject(new Error(`integration lock session exited ${code}`));
  });
});
holder.stdin.write(`select pg_advisory_lock(${lockKey}); select '${marker}';\n`);
await acquired;
// Rate counters intentionally outlive transactions in production. A full integration command owns
// the local service while holding this lock, so start and finish with no cross-command limiter state.
let childExit = { code: 1 };
let executionError;
try {
  clearIntegrationEphemeralState();
  launcher.stdin.end('run');
  childExit = await new Promise((resolveExit) => {
    launcher.once('error', (error) => resolveExit({ code: 1, error }));
    launcher.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  clearIntegrationEphemeralState();
} catch (error) {
  executionError = error;
  launcher.stdin.end();
  terminateProcessGroup(launcher.pid);
} finally {
  holder.stdin.end('\\q\n');
  await holderClosed;
}
if (executionError) console.error(executionError);
if (childExit.error) console.error(childExit.error);
process.exitCode = signalExitCode ?? (executionError ? 1 : (childExit.code ?? 1));
