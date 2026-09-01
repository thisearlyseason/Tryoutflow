import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';

import { resolveAndValidateLocalDatabase } from './lib/local-supabase-database.mjs';

const applicationPort = 3112;
const residueKeys = [
  'abuseRateLimits',
  'analyticsOutboxEvents',
  'authUsers',
  'botTokenReceipts',
  'fixtureDatabases',
  'fixtureOrganizations',
  'fixtureRoles',
  'fixtureSchemas',
  'fixtureSessions',
  'fixtureTriggers',
  'membershipCommandReceipts',
  'organizations',
  'rateCounters',
];

function localDatabaseUrl() {
  const local = JSON.parse(
    execFileSync('./node_modules/.bin/supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  if (typeof local.DB_URL !== 'string' || !local.DB_URL.startsWith('postgresql://')) {
    throw new Error('local Supabase status did not provide an exact PostgreSQL database URL');
  }
  return local.DB_URL;
}

function validatedDatabase() {
  const statusDatabaseUrl = localDatabaseUrl();
  const configuredDatabaseUrl = process.env.SUPABASE_DB_URL ?? statusDatabaseUrl;
  const local = resolveAndValidateLocalDatabase(statusDatabaseUrl);
  const configured = resolveAndValidateLocalDatabase(configuredDatabaseUrl);
  if (configured.identity !== local.identity) {
    throw new Error('SUPABASE_DB_URL does not identify this repository local Supabase database');
  }
  return { databaseUrl: configuredDatabaseUrl, identity: local.identity };
}

function queryResidue(databaseUrl) {
  const sql = `select json_build_object(
    'abuseRateLimits',(select count(*) from private.abuse_rate_limits),
    'analyticsOutboxEvents',(select count(*) from public.analytics_outbox_events),
    'authUsers',(select count(*) from auth.users),
    'botTokenReceipts',(select count(*) from private.bot_token_receipts),
    'fixtureDatabases',(select count(*) from pg_database where datname ~ '^tryoutflow_(csv|roster|fixture)_[0-9a-f]{16}_'),
    'fixtureOrganizations',(select count(*) from public.organizations where slug like 't30-%' or slug like 'task30-onboarding-%'),
    'fixtureRoles',(select count(*) from pg_roles where rolname ~ '^tryoutflow_run_[0-9a-f]{16}$'),
    'fixtureSchemas',(select count(*) from pg_namespace where nspname ~ '^tryoutflow_harness_[0-9a-f]{16}$'),
    'fixtureSessions',(select count(*) from pg_stat_activity where usename ~ '^tryoutflow_run_[0-9a-f]{16}$'),
    'fixtureTriggers',(select count(*) from pg_trigger where tgname ~ '^tryoutflow_capture_(org|user)_[0-9a-f]{16}$'),
    'membershipCommandReceipts',(select count(*) from private.membership_command_receipts),
    'organizations',(select count(*) from public.organizations),
    'rateCounters',(select count(*) from public.registration_rate_counters)
  )`;
  return JSON.parse(
    execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

function portIsListening(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePort(listening);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export function assertNoReleaseResidue(counts, applicationListening) {
  for (const key of residueKeys) {
    const value = counts?.[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid release residue result: ${key}`);
    }
    if (value !== 0) throw new Error(`Release residue remains: ${key}=${value}`);
  }
  if (applicationListening) {
    throw new Error(`Release residue remains: application port ${applicationPort} is listening`);
  }
}

async function main() {
  const mode = process.argv[2];
  const { databaseUrl, identity } = validatedDatabase();
  if (mode === 'preflight') {
    console.log(`Validated local Supabase database identity ${identity.slice(0, 12)}.`);
    return;
  }
  if (mode === 'residue') {
    const counts = queryResidue(databaseUrl);
    const listening = await portIsListening(applicationPort);
    assertNoReleaseResidue(counts, listening);
    console.log('Local release residue counts are zero; application port 3112 is closed.');
    return;
  }
  throw new Error('Usage: node scripts/verify-release-state.mjs <preflight|residue>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
