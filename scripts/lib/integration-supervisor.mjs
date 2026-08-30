import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { appendFileSync } from 'node:fs';

import { createSupervisorStateStore } from './integration-supervisor-state.mjs';
import { resolveAndValidateLocalDatabase } from './local-supabase-database.mjs';

const [commandJson, ownerPidText, runId, expectedIdentity] = process.argv.slice(2);
const command = JSON.parse(commandJson ?? 'null');
const ownerPid = Number.parseInt(ownerPidText ?? '', 10);
if (!Array.isArray(command) || command.length === 0 || command.some((v) => typeof v !== 'string'))
  throw new Error('integration supervisor requires a non-empty string command array');
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 1)
  throw new Error('integration supervisor requires its directly owning process ID');
if (!/^[0-9a-f]{16}$/u.test(runId ?? ''))
  throw new Error('integration supervisor requires an unguessable run ID');
if (!/^[0-9a-f]{64}$/u.test(expectedIdentity ?? ''))
  throw new Error('integration supervisor requires a canonical database identity');

let requestedExitCode = null;
let cancellationGeneration = 0;
let supervisorState = 'validating-identity';
let commandChild;
let commandCompletion = Promise.resolve({ code: null, signal: null });
let holder;
let lockAcquired = false;
let escalation;
const cancellationWaiters = new Set();

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
  if (cancellationGeneration !== 0) return;
  cancellationGeneration += 1;
  for (const waiter of cancellationWaiters) waiter();
  cancellationWaiters.clear();
  signalOwnedGroup('SIGTERM');
  if (!lockAcquired && !commandChild) holder?.kill('SIGTERM');
  escalation = setTimeout(() => signalOwnedGroup('SIGKILL'), 1_000);
}

process.once('SIGINT', () => beginTermination(130));
process.once('SIGTERM', () => beginTermination(143));
const ownerWatch = setInterval(() => {
  if (process.ppid !== ownerPid) beginTermination(137);
}, 50);

function fence(generation = 0) {
  if (cancellationGeneration !== generation)
    throw new Error('integration supervisor cancelled before completing setup');
}

function transition(next, allowed) {
  if (!allowed.includes(supervisorState)) {
    throw new Error(`invalid integration supervisor transition ${supervisorState} -> ${next}`);
  }
  supervisorState = next;
}

async function phase(name, { allowCancellation = false } = {}) {
  if (process.env.NODE_ENV === 'test' && process.env.TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE) {
    appendFileSync(
      process.env.TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE,
      `${JSON.stringify({ phase: name, state: supervisorState, supervisorPid: process.pid, runId })}\n`,
    );
    if (process.env.TRYOUTFLOW_INTEGRATION_TEST_PAUSE_PHASE === name) {
      await new Promise((resolve) => {
        if (cancellationGeneration !== 0) resolve();
        else cancellationWaiters.add(resolve);
      });
    } else await new Promise((resolve) => setImmediate(resolve));
  }
  if (!allowCancellation) fence();
}

const signalExitCode = (signal) => 128 + ({ SIGINT: 2, SIGTERM: 15, SIGKILL: 9 }[signal] ?? 0);

function processIdentity(pid) {
  const output = execFileSync('ps', ['-o', 'pid=,pgid=,lstart=', '-p', String(pid)], {
    encoding: 'utf8',
  }).trim();
  const match = /^(\d+)\s+(\d+)\s+(.{24})$/u.exec(output);
  if (!match) throw new Error('unable to bind integration command process identity');
  return { pid: Number(match[1]), pgid: Number(match[2]), startedAt: match[3].trim() };
}

async function supervise() {
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) throw new Error('integration supervisor requires SUPABASE_DB_URL');
  const validated = resolveAndValidateLocalDatabase(databaseUrl);
  if (validated.identity !== expectedIdentity)
    throw new Error('database identity changed before supervision');
  await phase('identity-validation');

  const state = createSupervisorStateStore({ identity: validated.identity });
  const body = state.manifestBody(runId);
  const operationalDatabase = new URL(databaseUrl);
  operationalDatabase.search = '';
  operationalDatabase.hash = '';
  const operationalDatabaseUrl = operationalDatabase.toString();
  const runPassword = randomUUID();
  const lockKey = BigInt.asIntN(
    64,
    createHash('sha256')
      .update(`tryoutflow-integration:${validated.identity}`)
      .digest()
      .readBigUInt64BE(0),
  );

  const psql = (sql) =>
    execFileSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-At', operationalDatabaseUrl, '-c', sql],
      {
        encoding: 'utf8',
      },
    ).trim();
  const containerSuperuserPsql = (sql) => {
    const url = new URL(operationalDatabaseUrl);
    url.hostname = '127.0.0.1';
    url.port = '5432';
    url.username = 'supabase_admin';
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
        url.toString(),
        '-c',
        sql,
      ],
      { encoding: 'utf8' },
    ).trim();
  };

  function terminateRunSessions(exactRunId) {
    const exact = state.manifestBody(exactRunId);
    containerSuperuserPsql(
      `select pg_terminate_backend(pid) from pg_stat_activity where usename='${exact.role}' and pid<>pg_backend_pid()`,
    );
  }

  function readOwnedRoots(exactRunId) {
    const exact = state.manifestBody(exactRunId);
    if (
      psql(`select exists(select 1 from pg_namespace where nspname='${exact.ownershipSchema}')`) !==
      't'
    ) {
      if (psql(`select exists(select 1 from pg_roles where rolname='${exact.role}')`) === 't') {
        throw new Error('integration ownership registry is missing while its run role remains');
      }
      return { organizationIds: [], userIds: [] };
    }
    const ids = (table) =>
      containerSuperuserPsql(`select id from ${exact.ownershipSchema}.${table} order by id`)
        .split('\n')
        .filter((value) => /^[0-9a-f-]{36}$/iu.test(value));
    return { organizationIds: ids('organizations'), userIds: ids('users') };
  }

  function cleanupOwnedPrimaryFixtures(owned) {
    const uuidList = (ids) => ids.map((id) => `'${id}'::uuid`).join(',');
    const organizations = owned.organizationIds ?? [];
    const users = owned.userIds ?? [];
    const orgArray = organizations.length ? `array[${uuidList(organizations)}]` : 'array[]::uuid[]';
    const userArray = users.length ? `array[${uuidList(users)}]` : 'array[]::uuid[]';
    psql(`begin; set local session_replication_role=replica;
      do $cleanup$ declare target_table text; begin
        for target_table in select format('%I.%I',c.table_schema,c.table_name)
          from information_schema.columns c join information_schema.tables t
          on t.table_schema=c.table_schema and t.table_name=c.table_name
          where c.table_schema='public' and c.column_name='organization_id'
          and c.table_name<>'organizations' and t.table_type='BASE TABLE' order by c.table_name
        loop execute format('delete from %s where organization_id=any($1)',target_table)
          using ${orgArray}; end loop;
      end $cleanup$;
      delete from public.profiles where id=any(${userArray});
      set local session_replication_role=origin;
      delete from public.organizations where id=any(${orgArray});
      delete from auth.users where id=any(${userArray}); commit;`);
  }

  function cleanupDatabases(exactRunId) {
    for (const prefix of state.manifestBody(exactRunId).databasePrefixes) {
      const names = psql(
        `select datname from pg_database where left(datname,${prefix.length})='${prefix}' order by datname`,
      )
        .split('\n')
        .filter(Boolean);
      for (const name of names) {
        if (!new RegExp(`^${prefix}[a-z0-9_]+$`, 'u').test(name))
          throw new Error(`refusing unexpected integration database name ${name}`);
        containerSuperuserPsql(`drop database if exists "${name}" with (force)`);
      }
    }
  }

  function cleanupRegistryAndRole(exactRunId) {
    const exact = state.manifestBody(exactRunId);
    containerSuperuserPsql(`begin; set local client_min_messages=warning;
      drop trigger if exists tryoutflow_capture_org_${exactRunId} on public.organizations;
      drop trigger if exists tryoutflow_capture_user_${exactRunId} on auth.users;
      drop schema if exists ${exact.ownershipSchema} cascade;
      do $drop$ begin if exists(select 1 from pg_roles where rolname='${exact.role}') then
        execute 'drop owned by ${exact.role} cascade'; execute 'drop role ${exact.role}';
      end if; end $drop$; commit;`);
  }

  function cleanupRateKeys(exactRunId) {
    const keys = state.readRateKeys(exactRunId);
    if (keys.length)
      psql(
        `delete from public.registration_rate_counters where key_hash in(${keys.map((k) => `'${k}'`).join(',')})`,
      );
  }

  function cleanupRun(exactRunId) {
    const manifest = state
      .readRecoverableManifests()
      .find((candidate) => candidate.body.runId === exactRunId);
    if (!manifest) return [];
    let cleanupStage = manifest.cleanupStage;
    const failHook = (name) => {
      if (
        process.env.NODE_ENV === 'test' &&
        process.env.TRYOUTFLOW_INTEGRATION_TEST_FAIL_CLEANUP_STAGE === name
      ) {
        throw new Error(`injected integration cleanup failure at ${name}`);
      }
    };
    try {
      if (cleanupStage === 'active') {
        terminateRunSessions(exactRunId);
        const exact = state.manifestBody(exactRunId);
        if (
          containerSuperuserPsql(
            `select count(*) from pg_stat_activity where usename='${exact.role}' and pid<>pg_backend_pid()`,
          ) !== '0'
        ) {
          throw new Error('owned integration sessions remain');
        }
        state.advanceCleanup(exactRunId, 'sessions-terminated');
        cleanupStage = 'sessions-terminated';
      }
      if (cleanupStage === 'sessions-terminated') {
        failHook('databases');
        cleanupDatabases(exactRunId);
        const prefixes = state.manifestBody(exactRunId).databasePrefixes;
        const remaining = prefixes.reduce(
          (count, prefix) =>
            count +
            Number(
              psql(
                `select count(*) from pg_database where left(datname,${prefix.length})='${prefix}'`,
              ),
            ),
          0,
        );
        if (remaining !== 0) throw new Error('owned integration databases remain');
        state.advanceCleanup(exactRunId, 'fixtures-removed');
        cleanupStage = 'fixtures-removed';
      }
      if (cleanupStage === 'fixtures-removed') {
        failHook('roots');
        const owned = readOwnedRoots(exactRunId);
        cleanupOwnedPrimaryFixtures(owned);
        const uuidList = (ids) => ids.map((id) => `'${id}'::uuid`).join(',');
        const organizations = owned.organizationIds.length
          ? `array[${uuidList(owned.organizationIds)}]`
          : 'array[]::uuid[]';
        const users = owned.userIds.length
          ? `array[${uuidList(owned.userIds)}]`
          : 'array[]::uuid[]';
        if (
          psql(
            `select (select count(*) from public.organizations where id=any(${organizations}))+(select count(*) from auth.users where id=any(${users}))`,
          ) !== '0'
        ) {
          throw new Error('owned integration roots remain');
        }
        state.advanceCleanup(exactRunId, 'roots-removed');
        cleanupStage = 'roots-removed';
      }
      if (cleanupStage === 'roots-removed') {
        failHook('rate-keys');
        cleanupRateKeys(exactRunId);
        const keys = state.readRateKeys(exactRunId);
        if (
          keys.length &&
          psql(
            `select count(*) from public.registration_rate_counters where key_hash in(${keys.map((key) => `'${key}'`).join(',')})`,
          ) !== '0'
        ) {
          throw new Error('owned integration rate counters remain');
        }
        state.advanceCleanup(exactRunId, 'rate-keys-removed');
        cleanupStage = 'rate-keys-removed';
      }
      if (cleanupStage === 'rate-keys-removed') {
        failHook('registry');
        cleanupRegistryAndRole(exactRunId);
        const exact = state.manifestBody(exactRunId);
        if (
          psql(
            `select (select count(*) from pg_roles where rolname='${exact.role}')+(select count(*) from pg_namespace where nspname='${exact.ownershipSchema}')+(select count(*) from pg_trigger where tgname in('tryoutflow_capture_org_${exactRunId}','tryoutflow_capture_user_${exactRunId}'))`,
          ) !== '0'
        ) {
          throw new Error('owned integration registry remains');
        }
        state.advanceCleanup(exactRunId, 'registry-removed');
        cleanupStage = 'registry-removed';
      }
      if (cleanupStage === 'registry-removed') state.removeRunState(exactRunId);
      return [];
    } catch (error) {
      return [error];
    }
  }

  function recoverStaleManifests() {
    const errors = state
      .readRecoverableManifests(runId)
      .flatMap((manifest) => cleanupRun(manifest.body.runId));
    if (errors.length) throw new AggregateError(errors, 'stale integration recovery failed');
  }

  function setupRegistryAndRole() {
    containerSuperuserPsql(`begin;
      create role ${body.role} login superuser password '${runPassword}';
      create schema ${body.ownershipSchema} authorization ${body.role};
      create table ${body.ownershipSchema}.organizations(id uuid primary key);
      create table ${body.ownershipSchema}.users(id uuid primary key);
      alter table ${body.ownershipSchema}.organizations owner to ${body.role};
      alter table ${body.ownershipSchema}.users owner to ${body.role};
      create function ${body.ownershipSchema}.capture_organization() returns trigger language plpgsql
        security definer set search_path=pg_catalog,${body.ownershipSchema} as $fn$ begin
        if session_user='${body.role}' then insert into ${body.ownershipSchema}.organizations(id)
        values(new.id) on conflict do nothing; end if; return new; end $fn$;
      create function ${body.ownershipSchema}.capture_user() returns trigger language plpgsql
        security definer set search_path=pg_catalog,${body.ownershipSchema} as $fn$ begin
        if session_user='${body.role}' then insert into ${body.ownershipSchema}.users(id)
        values(new.id) on conflict do nothing; end if; return new; end $fn$;
      alter function ${body.ownershipSchema}.capture_organization() owner to ${body.role};
      alter function ${body.ownershipSchema}.capture_user() owner to ${body.role};
      create trigger tryoutflow_capture_org_${runId} after insert on public.organizations
        for each row execute function ${body.ownershipSchema}.capture_organization();
      create trigger tryoutflow_capture_user_${runId} after insert on auth.users
        for each row execute function ${body.ownershipSchema}.capture_user(); commit;`);
  }

  const marker = `lock-acquired-${randomUUID()}`;
  fence();
  transition('waiting-lock', ['validating-identity']);
  holder = spawn('psql', ['-X', '-qAt', operationalDatabaseUrl], {
    env: { ...process.env, PGAPPNAME: `tryoutflow-integration-supervisor:${runId}` },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let holderOutput = '';
  const holderClosed = new Promise((resolve) => holder.once('close', resolve));
  const acquired = new Promise((resolve, reject) => {
    holder.stdout.setEncoding('utf8').on('data', (chunk) => {
      holderOutput += chunk;
      if (holderOutput.includes(marker)) resolve();
    });
    holder.once('error', reject);
    holder.once('close', (code) => {
      if (!holderOutput.includes(marker))
        reject(new Error(`integration lock session exited ${code}`));
    });
  });
  holder.stdin.write(`select pg_advisory_lock(${lockKey}); select '${marker}';\n`);

  let childResult = { code: 1, signal: null };
  let executionError;
  try {
    await phase('waiting-lock');
    await acquired;
    lockAcquired = true;
    fence();
    transition('post-lock', ['waiting-lock']);
    await phase('post-lock');
    fence();
    transition('recovering', ['post-lock']);
    recoverStaleManifests();
    await phase('recovery');
    fence();
    transition('committing-manifest', ['recovering']);
    state.writeManifest(body);
    await phase('manifest-commit');
    fence();
    transition('creating-registry', ['committing-manifest']);
    setupRegistryAndRole();
    await phase('registry-transaction');
    transition('preparing-command', ['creating-registry']);
    await phase('counter-fixture-setup');
    await phase('pre-spawn');
    fence();
    const testDatabase = new URL(operationalDatabaseUrl);
    testDatabase.username = body.role;
    testDatabase.password = runPassword;
    const commandNonce = randomBytes(16).toString('hex');
    state.writeCommand(runId, { nonce: commandNonce });
    transition('running-command', ['preparing-command']);
    commandChild = spawn(
      process.execPath,
      [
        resolve('scripts/lib/integration-command-launcher.mjs'),
        JSON.stringify(command),
        state.commandGoPath(runId),
        commandNonce,
      ],
      {
        env: {
          ...process.env,
          PGAPPNAME: `tryoutflow-integration-run:${runId}`,
          SUPABASE_DB_URL: testDatabase.toString(),
          TRYOUTFLOW_INTEGRATION_RUN_ID: runId,
          TRYOUTFLOW_INTEGRATION_RATE_KEY_LOG: state.rateKeyPath(runId),
        },
        stdio: 'inherit',
        detached: true,
      },
    );
    commandCompletion = new Promise((resolve) => {
      commandChild.once('error', (error) => resolve({ code: 1, signal: null, error }));
      commandChild.once('close', (code, signal) => resolve({ code, signal }));
    });
    await phase('spawned-unbound');
    const commandIdentity = processIdentity(commandChild.pid);
    if (commandIdentity.pid !== commandIdentity.pgid) {
      throw new Error('integration command launcher did not create an isolated process group');
    }
    state.bindCommand(runId, { ...commandIdentity, nonce: commandNonce });
    await phase('post-spawn');
    fence();
    state.permitCommand(runId);
    await phase('active');
    childResult = await commandCompletion;
  } catch (error) {
    executionError = error;
    beginTermination(requestedExitCode ?? 1);
  } finally {
    supervisorState = 'cleaning';
    signalOwnedGroup('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 50));
    signalOwnedGroup('SIGKILL');
    if (commandChild) await commandCompletion;
    if (escalation) clearTimeout(escalation);
    await phase('cleanup', { allowCancellation: true });
    state?.removeCommand(runId);
    if (lockAcquired) {
      const errors = cleanupRun(runId);
      if (errors.length)
        executionError ??= new AggregateError(errors, 'integration cleanup failed');
    }
    if (holder && !holder.killed) holder.stdin.end('\\q\n');
    await holderClosed;
    supervisorState = 'finished';
  }
  if (executionError && requestedExitCode === null) console.error(executionError);
  if (childResult.error) console.error(childResult.error);
  return (
    requestedExitCode ??
    (executionError
      ? 1
      : (childResult.code ?? (childResult.signal ? signalExitCode(childResult.signal) : 1)))
  );
}

let exitCode = 1;
try {
  exitCode = await supervise();
} catch (error) {
  if (requestedExitCode === null) console.error(error);
  exitCode = requestedExitCode ?? 1;
} finally {
  if (escalation) clearTimeout(escalation);
  clearInterval(ownerWatch);
}
process.exitCode = exitCode;
