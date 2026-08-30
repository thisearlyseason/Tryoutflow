import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAndValidateLocalDatabase } from './local-supabase-database.mjs';

const [commandJson, ownerPidText, runId, expectedIdentity] = process.argv.slice(2);
const command = JSON.parse(commandJson ?? 'null');
const ownerPid = Number.parseInt(ownerPidText ?? '', 10);
if (
  !Array.isArray(command) ||
  command.length === 0 ||
  command.some((value) => typeof value !== 'string')
) {
  throw new Error('integration supervisor requires a non-empty string command array');
}
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 1) {
  throw new Error('integration supervisor requires its directly owning process ID');
}
if (!runId || !/^[0-9a-f]{16}$/u.test(runId)) {
  throw new Error('integration supervisor requires an unguessable run ID');
}
if (!expectedIdentity || !/^[0-9a-f]{64}$/u.test(expectedIdentity)) {
  throw new Error('integration supervisor requires a canonical database identity');
}

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) throw new Error('integration supervisor requires SUPABASE_DB_URL');
// The independent cleanup owner repeats the read-only local identity proof rather than trusting its
// launcher. No lock, manifest, SQL mutation, or test process exists before this returns successfully.
const validated = resolveAndValidateLocalDatabase(databaseUrl);
if (validated.identity !== expectedIdentity)
  throw new Error('database identity changed before supervision');
const operationalDatabase = new URL(databaseUrl);
operationalDatabase.search = '';
operationalDatabase.hash = '';
const operationalDatabaseUrl = operationalDatabase.toString();

const lockKey = BigInt.asIntN(
  64,
  createHash('sha256')
    .update(`tryoutflow-integration:${validated.identity}`)
    .digest()
    .readBigUInt64BE(0),
);
const identityDirectory = join(tmpdir(), 'tryoutflow-integration-runs', validated.identity);
const manifestPath = join(identityDirectory, `${runId}.json`);
const databasePrefixes = [
  `tryoutflow_csv_${runId}_`,
  `tryoutflow_roster_${runId}_`,
  `tryoutflow_fixture_${runId}_`,
];
const runRole = `tryoutflow_run_${runId}`;
const runPassword = randomUUID();
const ownershipSchema = `tryoutflow_harness_${runId}`;

let requestedExitCode = null;
let commandChild;
let holder;
let lockAcquired = false;
let terminating = false;
let escalation;

function signalOwnedGroup(signal) {
  if (!commandChild?.pid) return;
  try {
    process.kill(-commandChild.pid, signal);
  } catch {
    // The directly spawned process group is already gone.
  }
}

function beginTermination(exitCode) {
  requestedExitCode ??= exitCode;
  if (terminating) return;
  terminating = true;
  signalOwnedGroup('SIGTERM');
  if (!commandChild) holder?.kill('SIGTERM');
  escalation = setTimeout(() => signalOwnedGroup('SIGKILL'), 1_000);
}

process.once('SIGINT', () => beginTermination(130));
process.once('SIGTERM', () => beginTermination(143));
const ownerWatch = setInterval(() => {
  if (process.ppid !== ownerPid) beginTermination(137);
}, 50);

const marker = `lock-acquired-${randomUUID()}`;
holder = spawn('psql', ['-X', '-qAt', operationalDatabaseUrl], {
  env: { ...process.env, PGAPPNAME: `tryoutflow-integration-supervisor:${runId}` },
  stdio: ['pipe', 'pipe', 'inherit'],
});
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

function psql(sql) {
  return execFileSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', operationalDatabaseUrl, '-c', sql],
    {
      encoding: 'utf8',
    },
  ).trim();
}

function containerSuperuserPsql(sql) {
  const containerDatabase = new URL(operationalDatabaseUrl);
  containerDatabase.hostname = '127.0.0.1';
  containerDatabase.port = '5432';
  containerDatabase.username = 'supabase_admin';
  return execFileSync(
    'docker',
    [
      'exec',
      validated.name,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      containerDatabase.toString(),
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function runPrefixes(id) {
  if (!/^[0-9a-f]{16}$/u.test(id)) throw new Error('invalid stale integration run manifest');
  return [`tryoutflow_csv_${id}_`, `tryoutflow_roster_${id}_`, `tryoutflow_fixture_${id}_`];
}

function validatedRunRole(role) {
  if (!/^tryoutflow_run_[0-9a-f]{16}$/u.test(role)) {
    throw new Error('invalid integration run role');
  }
  return role;
}

function terminateRunSessions(role) {
  if (!role) return;
  const exactRole = validatedRunRole(role);
  containerSuperuserPsql(
    `select pg_terminate_backend(pid) from pg_stat_activity where usename='${exactRole}' and pid<>pg_backend_pid()`,
  );
}

function dropRunRole(role) {
  if (!role) return;
  const exactRole = validatedRunRole(role);
  if (psql(`select exists(select 1 from pg_roles where rolname='${exactRole}')`) !== 't') return;
  containerSuperuserPsql(`drop owned by ${exactRole} cascade; drop role if exists ${exactRole}`);
}

function validatedOwnershipSchema(schema) {
  if (!/^tryoutflow_harness_[0-9a-f]{16}$/u.test(schema)) {
    throw new Error('invalid integration ownership schema');
  }
  return schema;
}

function setupOwnershipRegistry(schema, role) {
  const exactSchema = validatedOwnershipSchema(schema);
  const exactRole = validatedRunRole(role);
  const suffix = exactSchema.slice('tryoutflow_harness_'.length);
  containerSuperuserPsql(`
    create schema ${exactSchema} authorization ${exactRole};
    create table ${exactSchema}.organizations(id uuid primary key);
    create table ${exactSchema}.users(id uuid primary key);
    alter table ${exactSchema}.organizations owner to ${exactRole};
    alter table ${exactSchema}.users owner to ${exactRole};
    create function ${exactSchema}.capture_organization() returns trigger
      language plpgsql security definer set search_path=pg_catalog,${exactSchema} as $function$
      begin
        if session_user='${exactRole}' then
          insert into ${exactSchema}.organizations(id) values(new.id) on conflict do nothing;
        end if;
        return new;
      end
      $function$;
    create function ${exactSchema}.capture_user() returns trigger
      language plpgsql security definer set search_path=pg_catalog,${exactSchema} as $function$
      begin
        if session_user='${exactRole}' then
          insert into ${exactSchema}.users(id) values(new.id) on conflict do nothing;
        end if;
        return new;
      end
      $function$;
    alter function ${exactSchema}.capture_organization() owner to ${exactRole};
    alter function ${exactSchema}.capture_user() owner to ${exactRole};
    create trigger tryoutflow_capture_org_${suffix} after insert on public.organizations
      for each row execute function ${exactSchema}.capture_organization();
    create trigger tryoutflow_capture_user_${suffix} after insert on auth.users
      for each row execute function ${exactSchema}.capture_user();
  `);
}

function readOwnedRoots(schema) {
  const exactSchema = validatedOwnershipSchema(schema);
  if (psql(`select exists(select 1 from pg_namespace where nspname='${exactSchema}')`) !== 't') {
    return { organizationIds: [], userIds: [] };
  }
  return {
    organizationIds: containerSuperuserPsql(
      `select id from ${exactSchema}.organizations order by id`,
    )
      .split('\n')
      .filter(Boolean),
    userIds: containerSuperuserPsql(`select id from ${exactSchema}.users order by id`)
      .split('\n')
      .filter(Boolean),
  };
}

function teardownOwnershipRegistry(schema) {
  if (!schema) return;
  const exactSchema = validatedOwnershipSchema(schema);
  const suffix = exactSchema.slice('tryoutflow_harness_'.length);
  containerSuperuserPsql(`
    set client_min_messages=warning;
    drop trigger if exists tryoutflow_capture_org_${suffix} on public.organizations;
    drop trigger if exists tryoutflow_capture_user_${suffix} on auth.users;
    drop schema if exists ${exactSchema} cascade;
  `);
}

function validatedIds(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error(`invalid ${label} in integration run manifest`);
  }
  for (const value of values) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) {
      throw new Error(`invalid ${label} in integration run manifest`);
    }
  }
  return new Set(values.map((value) => value.toLowerCase()));
}

function cleanupOwnedPrimaryFixtures(owned) {
  const organizations = [...validatedIds(owned.organizationIds, 'owned organizations')];
  const users = [...validatedIds(owned.userIds, 'owned users')];
  const uuidList = (ids) => ids.map((id) => `'${id}'::uuid`).join(',');
  const organizationArray =
    organizations.length > 0 ? `array[${uuidList(organizations)}]` : 'array[]::uuid[]';
  const userArray = users.length > 0 ? `array[${uuidList(users)}]` : 'array[]::uuid[]';
  psql(`
    begin;
    set local session_replication_role=replica;
    do $cleanup$
    declare target_table text;
    begin
      for target_table in
        select format('%I.%I',columns.table_schema,columns.table_name)
        from information_schema.columns columns
        join information_schema.tables tables
          on tables.table_schema=columns.table_schema and tables.table_name=columns.table_name
        where columns.table_schema='public'
          and columns.column_name='organization_id'
          and columns.table_name<>'organizations'
          and tables.table_type='BASE TABLE'
        order by columns.table_name
      loop
        execute format('delete from %s where organization_id=any($1)',target_table)
          using ${organizationArray};
      end loop;
    end
    $cleanup$;
    delete from public.profiles where id=any(${userArray});
    set local session_replication_role=origin;
    delete from public.organizations where id=any(${organizationArray});
    delete from auth.users where id=any(${userArray});
    commit;
  `);
}

function cleanupPrefixes(prefixes) {
  for (const prefix of prefixes) {
    if (!/^tryoutflow_(?:csv|roster|fixture)_[0-9a-f]{16}_$/u.test(prefix)) {
      throw new Error('refusing an invalid integration database prefix');
    }
    const names = psql(
      `select datname from pg_database where left(datname,${prefix.length})='${prefix}' order by datname`,
    )
      .split('\n')
      .filter(Boolean);
    for (const name of names) {
      if (!new RegExp(`^${prefix}[a-z0-9_]+$`, 'u').test(name)) {
        throw new Error(`refusing unexpected integration database name ${name}`);
      }
      containerSuperuserPsql(`drop database if exists "${name}" with (force)`);
    }
  }
}

function recoverStaleManifests() {
  mkdirSync(identityDirectory, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(identityDirectory)) {
    if (!entry.endsWith('.json') || entry === `${runId}.json`) continue;
    const manifest = JSON.parse(readFileSync(join(identityDirectory, entry), 'utf8'));
    terminateRunSessions(manifest.role);
    const owned = manifest.ownershipSchema
      ? readOwnedRoots(manifest.ownershipSchema)
      : { organizationIds: [], userIds: [] };
    cleanupPrefixes(runPrefixes(manifest.runId));
    cleanupOwnedPrimaryFixtures(owned);
    teardownOwnershipRegistry(manifest.ownershipSchema);
    dropRunRole(manifest.role);
    rmSync(join(identityDirectory, entry), { force: true });
  }
}

let childResult = { code: 1, signal: null };
let executionError;
try {
  await acquired;
  lockAcquired = true;
  if (requestedExitCode !== null)
    throw new Error('integration supervisor stopped before command start');
  recoverStaleManifests();
  writeFileSync(
    manifestPath,
    JSON.stringify({ runId, databasePrefixes, role: runRole, ownershipSchema }),
    {
      mode: 0o600,
    },
  );
  containerSuperuserPsql(`create role ${runRole} login superuser password '${runPassword}'`);
  setupOwnershipRegistry(ownershipSchema, runRole);
  // Rate buckets outlive transactions. Service-bound suites are serialized against this exact,
  // validated local database, so the local-only boundary may reset them under the exclusive lock.
  psql('delete from public.registration_rate_counters');
  const testDatabase = new URL(operationalDatabaseUrl);
  testDatabase.username = runRole;
  testDatabase.password = runPassword;
  const testDatabaseUrl = testDatabase.toString();
  const [executable, ...args] = command;
  commandChild = spawn(executable, args, {
    env: {
      ...process.env,
      PGAPPNAME: `tryoutflow-integration-run:${runId}`,
      SUPABASE_DB_URL: testDatabaseUrl,
      TRYOUTFLOW_INTEGRATION_RUN_ID: runId,
    },
    stdio: 'inherit',
    detached: true,
  });
  childResult = await new Promise((resolveResult) => {
    commandChild.once('error', (error) => resolveResult({ code: 1, signal: null, error }));
    commandChild.once('close', (code, signal) => resolveResult({ code, signal }));
  });
} catch (error) {
  executionError = error;
  beginTermination(requestedExitCode ?? 1);
} finally {
  signalOwnedGroup('SIGTERM');
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  signalOwnedGroup('SIGKILL');
  if (escalation) clearTimeout(escalation);
  if (lockAcquired) {
    try {
      terminateRunSessions(runRole);
      const owned = readOwnedRoots(ownershipSchema);
      cleanupPrefixes(databasePrefixes);
      cleanupOwnedPrimaryFixtures(owned);
      teardownOwnershipRegistry(ownershipSchema);
      dropRunRole(runRole);
      psql('delete from public.registration_rate_counters');
      rmSync(manifestPath, { force: true });
    } catch (cleanupError) {
      executionError ??= cleanupError;
    }
  }
  clearInterval(ownerWatch);
  if (!holder.killed) holder.stdin.end('\\q\n');
  await holderClosed;
}

if (executionError) console.error(executionError);
if (childResult.error) console.error(childResult.error);
const signalNumbers = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9 };
process.exitCode =
  requestedExitCode ??
  (executionError
    ? 1
    : (childResult.code ??
      (childResult.signal ? 128 + (signalNumbers[childResult.signal] ?? 0) : 1)));
