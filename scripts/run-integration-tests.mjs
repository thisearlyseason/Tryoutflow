import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
const runId = randomBytes(8).toString('hex');
const supervisor = spawn(
  process.execPath,
  [
    resolve('scripts/lib/integration-supervisor.mjs'),
    JSON.stringify(commandToRun()),
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
const reaper = spawn(
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

let requestedExitCode = null;
const forward = (signal, exitCode) => {
  requestedExitCode ??= exitCode;
  try {
    supervisor.kill(signal);
  } catch {
    // The directly owned supervisor is already gone.
  }
};
process.once('SIGINT', () => forward('SIGINT', 130));
process.once('SIGTERM', () => forward('SIGTERM', 143));

const result = await new Promise((resolveResult) => {
  supervisor.once('error', (error) => resolveResult({ code: 1, error }));
  supervisor.once('close', (code, signal) => resolveResult({ code, signal }));
});
const reaperResult = await new Promise((resolveResult) => {
  reaper.once('error', (error) => resolveResult({ code: 1, error }));
  reaper.once('close', (code, signal) => resolveResult({ code, signal }));
});
if (result.error) console.error(result.error);
if (reaperResult.error) console.error(reaperResult.error);
const signalNumbers = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };
process.exitCode =
  requestedExitCode ??
  (result.code === 0 && reaperResult.code !== 0
    ? 1
    : (result.code ??
      (result.signal ? 128 + (signalNumbers[result.signal] ?? 0) : (reaperResult.code ?? 1))));
