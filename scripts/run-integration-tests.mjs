import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { resolveAndValidateLocalDatabase } from './lib/local-supabase-database.mjs';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function commandToRun() {
  if (process.env.TRYOUTFLOW_INTEGRATION_TEST_COMMAND) {
    if (process.env.NODE_ENV !== 'test')
      throw new Error('integration test command override is test-only');
    const parsed = JSON.parse(process.env.TRYOUTFLOW_INTEGRATION_TEST_COMMAND);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some((value) => typeof value !== 'string')
    ) {
      throw new Error('integration test command override must be a non-empty string array');
    }
    return parsed;
  }
  const requestedTests = process.argv.slice(2);
  return [
    process.execPath,
    resolve('node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    'vitest.integration.config.ts',
    ...(requestedTests.length > 0 ? requestedTests : ['tests/integration']),
  ];
}

// This read-only identity proof is deliberately the first stateful boundary. Invalid, ambiguous,
// non-Docker, and remote targets cannot launch a supervisor, acquire a lock, or execute cleanup SQL.
const validated = resolveAndValidateLocalDatabase(databaseUrl);
const requestedCommand = commandToRun();
const runId = randomBytes(8).toString('hex');
const operationalDatabase = new URL(databaseUrl);
operationalDatabase.search = '';
operationalDatabase.hash = '';
const lockKey = BigInt.asIntN(
  64,
  createHash('sha256')
    .update(`tryoutflow-integration:${validated.identity}`)
    .digest()
    .readBigUInt64BE(0),
);
const lockMarker = `lock-acquired-${randomUUID()}`;
const holder = spawn('psql', ['-X', '-qAt', operationalDatabase.toString()], {
  env: { ...process.env, PGAPPNAME: `tryoutflow-integration-runner:${runId}` },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let holderOutput = '';
const holderClosed = new Promise((resolveClosed) => holder.once('close', resolveClosed));
const lockAcquired = new Promise((resolveAcquired, rejectAcquired) => {
  holder.stdout.setEncoding('utf8').on('data', (chunk) => {
    holderOutput += chunk;
    if (holderOutput.includes(lockMarker)) resolveAcquired();
  });
  holder.once('error', rejectAcquired);
  holder.once('close', (code) => {
    if (!holderOutput.includes(lockMarker))
      rejectAcquired(new Error(`integration lock session exited ${code}`));
  });
});
holder.stdin.write(`select pg_advisory_lock(${lockKey}); select '${lockMarker}';\n`);

let supervisor;
let reaper;
let requestedExitCode = null;
const forward = (signal, exitCode) => {
  requestedExitCode ??= exitCode;
  if (supervisor) {
    try {
      supervisor.kill(signal);
    } catch {
      // The directly owned supervisor is already gone.
    }
  } else {
    holder.kill('SIGTERM');
  }
};
process.once('SIGINT', () => forward('SIGINT', 130));
process.once('SIGTERM', () => forward('SIGTERM', 143));

try {
  await lockAcquired;
} catch (error) {
  if (requestedExitCode === null) console.error(error);
  process.exitCode = requestedExitCode ?? 1;
  await holderClosed;
  process.exit();
}
if (requestedExitCode !== null) {
  holder.stdin.end('\\q\n');
  await holderClosed;
  process.exitCode = requestedExitCode;
  process.exit();
}

supervisor = spawn(
  process.execPath,
  [
    resolve('scripts/lib/integration-supervisor.mjs'),
    JSON.stringify(requestedCommand),
    String(process.pid),
    runId,
    validated.identity,
  ],
  {
    env: { ...process.env, SUPABASE_DB_URL: databaseUrl },
    stdio: 'inherit',
    detached: true,
  },
);
const supervisorStartedAt = execFileSync('ps', ['-o', 'lstart=', '-p', String(supervisor.pid)], {
  encoding: 'utf8',
}).trim();
if (!supervisorStartedAt) throw new Error('unable to bind integration supervisor identity');
reaper = spawn(
  process.execPath,
  [
    resolve('scripts/lib/integration-command-reaper.mjs'),
    String(supervisor.pid),
    supervisorStartedAt,
    runId,
    validated.identity,
  ],
  { env: process.env, stdio: 'inherit' },
);

const result = await new Promise((resolveResult) => {
  supervisor.once('error', (error) => resolveResult({ code: 1, error }));
  supervisor.once('close', (code, signal) => resolveResult({ code, signal }));
});
const reaperResult = await new Promise((resolveResult) => {
  reaper.once('error', (error) => resolveResult({ code: 1, error }));
  reaper.once('close', (code, signal) => resolveResult({ code, signal }));
});
let recoveryResult = { code: 0, signal: null };
if (result.signal) {
  const recoveryEnvironment = { ...process.env, SUPABASE_DB_URL: databaseUrl };
  delete recoveryEnvironment.TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE;
  delete recoveryEnvironment.TRYOUTFLOW_INTEGRATION_TEST_PAUSE_PHASE;
  delete recoveryEnvironment.TRYOUTFLOW_INTEGRATION_TEST_FAIL_CLEANUP_STAGE;
  const recovery = spawn(
    process.execPath,
    [
      resolve('scripts/lib/integration-supervisor.mjs'),
      '[]',
      String(process.pid),
      randomBytes(8).toString('hex'),
      validated.identity,
      'recovery-only',
    ],
    { env: recoveryEnvironment, stdio: 'inherit' },
  );
  recoveryResult = await new Promise((resolveResult) => {
    recovery.once('error', (error) => resolveResult({ code: 1, signal: null, error }));
    recovery.once('close', (code, signal) => resolveResult({ code, signal }));
  });
}
holder.stdin.end('\\q\n');
await holderClosed;
if (result.error) console.error(result.error);
if (reaperResult.error) console.error(reaperResult.error);
if (recoveryResult.error) console.error(recoveryResult.error);
const signalNumbers = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };
process.exitCode =
  requestedExitCode ??
  (result.code === 0 && (reaperResult.code !== 0 || recoveryResult.code !== 0)
    ? 1
    : (result.code ??
      (result.signal ? 128 + (signalNumbers[result.signal] ?? 0) : (reaperResult.code ?? 1))));
