// @vitest-environment node

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAndValidateLocalDatabase } from '../../../scripts/lib/local-supabase-database.mjs';
import { createSupervisorStateStore } from '../../../scripts/lib/integration-supervisor-state.mjs';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const runner = resolve('scripts/run-integration-tests.mjs');
const fixture = resolve('tests/fixtures/integration-lock/record-run.mjs');

describe('authenticated integration supervisor state', () => {
  it('accepts only an identity-bound, internally consistent, authentic manifest', () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-supervisor-state-'));
    chmodSync(baseDirectory, 0o700);
    const identity = '1'.repeat(64);
    const runId = '2'.repeat(16);
    const store = createSupervisorStateStore({ baseDirectory, identity });
    const body = store.manifestBody(runId);

    store.writeManifest(body);
    expect(store.readRecoverableManifests()).toEqual([{ body, path: store.manifestPath(runId) }]);

    const serialized = JSON.parse(readFileSync(store.manifestPath(runId), 'utf8')) as {
      body: typeof body;
      authentication: string;
    };
    serialized.body.role = `tryoutflow_run_${'3'.repeat(16)}`;
    writeFileSync(store.manifestPath(runId), JSON.stringify(serialized));
    expect(store.readRecoverableManifests()).toEqual([]);
    expect(readdirSync(store.directory).some((entry) => entry.includes('.quarantine-'))).toBe(true);
  });

  it('quarantines torn state and rejects symlinked or non-private state directories', () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-supervisor-state-adversarial-'));
    chmodSync(baseDirectory, 0o700);
    const store = createSupervisorStateStore({ baseDirectory, identity: '4'.repeat(64) });
    writeFileSync(join(store.directory, `${'5'.repeat(16)}.json`), '{"body":');
    expect(store.readRecoverableManifests()).toEqual([]);
    expect(readdirSync(store.directory).some((entry) => entry.includes('.quarantine-'))).toBe(true);

    const symlinkBase = join(baseDirectory, 'linked');
    symlinkSync(store.directory, symlinkBase);
    expect(() =>
      createSupervisorStateStore({ baseDirectory: symlinkBase, identity: '6'.repeat(64) }),
    ).toThrow(/symlink|private directory/u);

    const openBase = join(baseDirectory, 'open');
    mkdirSync(openBase, { mode: 0o755 });
    expect(() =>
      createSupervisorStateStore({ baseDirectory: openBase, identity: '7'.repeat(64) }),
    ).toThrow(/private directory/u);
  });
});

function start(
  output: string,
  holdMilliseconds: number,
  counterKey = createHash('sha256').update(randomUUID()).digest('hex'),
  options: {
    databaseUrl?: string;
    fixtureArguments?: string[];
    fixtureEnvironment?: NodeJS.ProcessEnv;
    hookFile?: string;
    pausePhase?: string;
  } = {},
) {
  return spawn(process.execPath, [runner], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SUPABASE_DB_URL: options.databaseUrl ?? databaseUrl,
      ...options.fixtureEnvironment,
      TRYOUTFLOW_INTEGRATION_TEST_COMMAND: JSON.stringify([
        process.execPath,
        fixture,
        output,
        String(holdMilliseconds),
        counterKey,
        ...(options.fixtureArguments ?? []),
      ]),
      ...(options.hookFile
        ? {
            TRYOUTFLOW_INTEGRATION_TEST_HOOK_FILE: options.hookFile,
            TRYOUTFLOW_INTEGRATION_TEST_PAUSE_PHASE: options.pausePhase,
          }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function completion(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>(
    (resolveCompletion) => {
      let stderr = '';
      child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
      child.once('close', (code, signal) => resolveCompletion({ code, signal, stderr }));
    },
  );
}

async function waitForFile(path: string, pattern: RegExp, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (pattern.test(readFileSync(path, 'utf8'))) return;
    } catch {
      // The supervised command has not written its first event yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`fixture did not write ${pattern}`);
}

function residue(prefix: string, counterKey: string) {
  return execFileSync(
    'psql',
    [
      '-X',
      '-At',
      databaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `select (select count(*) from pg_database where datname like '${prefix}%')||'|'||(select count(*) from public.registration_rate_counters where key_hash='${counterKey}')`,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function ownedFixtureResidue(
  runId: string,
  databasePrefix: string,
  counterKey: string,
  organizationId: string,
  userId: string,
) {
  return execFileSync(
    'psql',
    [
      '-X',
      '-At',
      databaseUrl,
      '-c',
      `select (select count(*) from pg_database where left(datname,${databasePrefix.length})='${databasePrefix}')||'|'||(select count(*) from public.registration_rate_counters where key_hash='${counterKey}')||'|'||(select count(*) from public.organizations where id='${organizationId}')||'|'||(select count(*) from auth.users where id='${userId}')||'|'||(select count(*) from pg_roles where rolname='tryoutflow_run_${runId}')`,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function supervisorResidue(runId: string, counterKey: string) {
  return execFileSync(
    'psql',
    [
      '-X',
      '-At',
      databaseUrl,
      '-c',
      `select (select count(*) from pg_database where datname like 'tryoutflow\\_%\\_${runId}\\_%' escape '\\')||'|'||(select count(*) from public.registration_rate_counters where key_hash='${counterKey}')||'|'||(select count(*) from pg_roles where rolname='tryoutflow_run_${runId}')||'|'||(select count(*) from pg_namespace where nspname='tryoutflow_harness_${runId}')||'|'||(select count(*) from pg_trigger where tgname in('tryoutflow_capture_org_${runId}','tryoutflow_capture_user_${runId}'))`,
    ],
    { encoding: 'utf8' },
  ).trim();
}

describe('full integration command database lock', () => {
  it('preserves unrelated durable counters while removing the exact supervised fixture counter', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-counter-owner-'));
    const fixtureCounter = createHash('sha256').update(randomUUID()).digest('hex');
    const unrelatedCounter = createHash('sha256').update(randomUUID()).digest('hex');
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${unrelatedCounter}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
    ]);
    try {
      const result = await completion(start(join(directory, 'run.jsonl'), 0, fixtureCounter));
      expect(result).toEqual({ code: 0, signal: null, stderr: '' });
      expect(residue('tryoutflow_fixture_never_', fixtureCounter)).toBe('0|0');
      expect(residue('tryoutflow_fixture_never_', unrelatedCounter)).toBe('0|1');
    } finally {
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `delete from public.registration_rate_counters where key_hash in('${fixtureCounter}','${unrelatedCounter}')`,
      ]);
    }
  });

  it.each(
    [
      'identity-validation',
      'waiting-lock',
      'post-lock',
      'recovery',
      'manifest-commit',
      'registry-transaction',
      'counter-fixture-setup',
      'pre-spawn',
      'cleanup',
    ].flatMap((phase) => [
      [phase, 'SIGTERM'],
      [phase, 'SIGKILL'],
    ]) as Array<[string, 'SIGTERM' | 'SIGKILL']>,
  )(
    'fences setup and cleans exact state at %s when the runner receives %s',
    async (phaseName, signal) => {
      const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-phase-signal-'));
      const output = join(directory, 'command.jsonl');
      const hooks = join(directory, 'hooks.jsonl');
      const fixtureCounter = createHash('sha256').update(randomUUID()).digest('hex');
      const unrelatedCounter = createHash('sha256').update(randomUUID()).digest('hex');
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${unrelatedCounter}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
      ]);
      try {
        const child = start(output, phaseName === 'cleanup' ? 0 : 30_000, fixtureCounter, {
          hookFile: hooks,
          pausePhase: phaseName,
        });
        await waitForFile(hooks, new RegExp(`"phase":"${phaseName}"`, 'u'), 10_000);
        const hook = readFileSync(hooks, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { phase: string; runId: string })
          .find((entry) => entry.phase === phaseName)!;
        child.kill(signal);
        const result = await completion(child);
        if (signal === 'SIGTERM') expect(result.code).toBe(143);
        else expect(result.signal).toBe('SIGKILL');

        const recovery = await completion(start(join(directory, 'recovery.jsonl'), 0));
        expect(recovery.code).toBe(0);
        expect(supervisorResidue(hook.runId, fixtureCounter)).toBe('0|0|0|0|0');
        expect(residue('tryoutflow_fixture_never_', unrelatedCounter)).toBe('0|1');
        if (phaseName !== 'cleanup') expect(existsSync(output)).toBe(false);
      } finally {
        execFileSync('psql', [
          databaseUrl,
          '-c',
          `delete from public.registration_rate_counters where key_hash in('${fixtureCounter}','${unrelatedCounter}')`,
        ]);
      }
    },
    30_000,
  );

  it('serializes simultaneous processes instead of overlapping shared fixtures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-lock-'));
    const output = join(directory, 'runs.jsonl');
    const counterKey = createHash('sha256').update(randomUUID()).digest('hex');
    const first = start(output, 300, counterKey);
    const second = start(output, 300, counterKey);
    const [firstResult, secondResult] = await Promise.all([completion(first), completion(second)]);

    expect(firstResult).toEqual({ code: 0, signal: null, stderr: '' });
    expect(secondResult).toEqual({ code: 0, signal: null, stderr: '' });
    const events = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; pid: number });
    expect(events.map(({ event }) => event)).toEqual(['start', 'end', 'start', 'end']);
    expect(events[0]!.pid).toBe(events[1]!.pid);
    expect(events[2]!.pid).toBe(events[3]!.pid);
    expect(events[0]!.pid).not.toBe(events[2]!.pid);
  });

  it('serializes localhost, numeric-loopback, credential-encoding, and query aliases', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-alias-'));
    const output = join(directory, 'runs.jsonl');
    const counterKey = createHash('sha256').update(randomUUID()).digest('hex');
    const aliases = [
      databaseUrl.replace('127.0.0.1', 'localhost'),
      databaseUrl.replace('postgres:postgres', 'post%67res:postgres') + '?application_name=alias',
    ];
    const results = await Promise.all(
      aliases.map((alias) => completion(start(output, 250, counterKey, { databaseUrl: alias }))),
    );
    expect(results.map(({ code }) => code)).toEqual([0, 0]);
    expect(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).event),
    ).toEqual(['start', 'end', 'start', 'end']);
  });

  it('rejects a non-local endpoint before running commands or clearing local state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-reject-'));
    const output = join(directory, 'runs.jsonl');
    const counterKey = createHash('sha256').update(randomUUID()).digest('hex');
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${counterKey}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
    ]);
    const result = await completion(
      start(output, 0, counterKey, {
        databaseUrl: 'postgresql://postgres:postgres@staging.example.com:54322/postgres',
      }),
    );
    expect(result.code).not.toBe(0);
    expect(() => readFileSync(output, 'utf8')).toThrow();
    expect(residue('tryoutflow_fixture_never_', counterKey)).toBe('0|1');
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `delete from public.registration_rate_counters where key_hash='${counterKey}'`,
    ]);
  });

  it('does not signal an unrelated process when a database application name is forged', async () => {
    const unrelated = spawn('sleep', ['30']);
    const spoof = spawn('psql', [databaseUrl, '-c', 'select pg_sleep(1)'], {
      env: { ...process.env, PGAPPNAME: `tryoutflow-integration-lock:1:forged:${unrelated.pid}` },
      stdio: 'ignore',
    });
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-spoof-'));
    const result = await completion(start(join(directory, 'run.jsonl'), 0));
    expect(result.code).toBe(0);
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    unrelated.kill('SIGKILL');
    spoof.kill('SIGKILL');
  });

  it('quarantines a forged mixed manifest without interrupting its referenced active run', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-forged-manifest-'));
    const output = join(directory, 'active.jsonl');
    const active = start(output, 500);
    await waitForFile(output, /"event":"start"/u);
    const activeRunId = (
      JSON.parse(readFileSync(output, 'utf8').trim().split('\n')[0]!) as { runId: string }
    ).runId;
    const validated = resolveAndValidateLocalDatabase(databaseUrl);
    const state = createSupervisorStateStore({ identity: validated.identity });
    const forgedRunId = randomUUID().replaceAll('-', '').slice(0, 16);
    state.writeManifest(state.manifestBody(forgedRunId));
    const forgedPath = state.manifestPath(forgedRunId);
    const forged = JSON.parse(readFileSync(forgedPath, 'utf8')) as {
      body: { role: string };
      authentication: string;
    };
    forged.body.role = `tryoutflow_run_${activeRunId}`;
    writeFileSync(forgedPath, JSON.stringify(forged));

    const followerOutput = join(directory, 'follower.jsonl');
    const follower = start(followerOutput, 0);
    const [activeResult, followerResult] = await Promise.all([
      completion(active),
      completion(follower),
    ]);
    expect(activeResult.code).toBe(0);
    expect(followerResult.code).toBe(0);
    expect(readFileSync(output, 'utf8')).toMatch(/"event":"end"/u);
    expect(readFileSync(followerOutput, 'utf8')).toMatch(/"event":"start"/u);
    expect(existsSync(forgedPath)).toBe(false);
    expect(
      readdirSync(state.directory).some((entry) =>
        entry.startsWith(`${forgedRunId}.json.quarantine-`),
      ),
    ).toBe(true);
  });

  it('recovers only exact resources named by a stale run manifest', async () => {
    const validated = resolveAndValidateLocalDatabase(databaseUrl);
    const staleRunId = randomUUID().replaceAll('-', '').slice(0, 16);
    const databaseName = `tryoutflow_fixture_${staleRunId}_stale`;
    const staleRole = `tryoutflow_run_${staleRunId}`;
    const staleOwnershipSchema = `tryoutflow_harness_${staleRunId}`;
    const staleOrganizationId = randomUUID();
    const staleUserId = randomUUID();
    const state = createSupervisorStateStore({ identity: validated.identity });
    const manifest = state.manifestPath(staleRunId);
    execFileSync('psql', [databaseUrl, '-c', `create role ${staleRole}`]);
    execFileSync('psql', [databaseUrl, '-c', `create database ${databaseName}`]);
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `create schema ${staleOwnershipSchema}; create table ${staleOwnershipSchema}.organizations(id uuid primary key); create table ${staleOwnershipSchema}.users(id uuid primary key)`,
    ]);
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `insert into auth.users(id) values('${staleUserId}'); insert into public.organizations(id,name,slug) values('${staleOrganizationId}','Stale owned fixture','stale-${staleRunId}')`,
    ]);
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `insert into ${staleOwnershipSchema}.organizations values('${staleOrganizationId}'); insert into ${staleOwnershipSchema}.users values('${staleUserId}')`,
    ]);
    state.writeManifest(state.manifestBody(staleRunId));
    try {
      const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-stale-'));
      const result = await completion(start(join(directory, 'run.jsonl'), 0));
      expect(result.code).toBe(0);
      expect(residue(`tryoutflow_fixture_${staleRunId}_`, '0'.repeat(64))).toBe('0|0');
      expect(
        ownedFixtureResidue(
          staleRunId,
          `tryoutflow_fixture_${staleRunId}_`,
          '0'.repeat(64),
          staleOrganizationId,
          staleUserId,
        ),
      ).toBe('0|0|0|0|0');
      expect(existsSync(manifest)).toBe(false);
    } finally {
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `drop database if exists ${databaseName} with (force)`,
      ]);
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `set session_replication_role=replica; delete from public.organizations where id='${staleOrganizationId}'; reset session_replication_role; delete from auth.users where id='${staleUserId}'; drop schema if exists ${staleOwnershipSchema} cascade; drop role if exists ${staleRole}`,
      ]);
      rmSync(manifest, { force: true });
    }
  });

  it('reclaims a lock session orphaned by forced runner termination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-lock-kill-'));
    const firstOutput = join(directory, 'first.jsonl');
    const recoveryOutput = join(directory, 'recovery.jsonl');
    const first = start(firstOutput, 30_000);

    await waitForFile(firstOutput, /"event":"start"/u);
    const firstExit = new Promise<void>((resolveExit) => first.once('exit', () => resolveExit()));
    first.kill('SIGKILL');
    await firstExit;

    const recovery = start(recoveryOutput, 0);
    const recovered = await completion(recovery);
    expect(recovered).toEqual({ code: 0, signal: null, stderr: '' });
    expect(readFileSync(recoveryOutput, 'utf8')).toMatch(/"event":"end"/u);
    const orphanPid = (
      JSON.parse(readFileSync(firstOutput, 'utf8').trim().split('\n')[0]!) as { pid: number }
    ).pid;
    await new Promise<void>((resolveExit, reject) => {
      const deadline = Date.now() + 2_000;
      const poll = () => {
        try {
          process.kill(orphanPid, 0);
        } catch {
          return resolveExit();
        }
        if (Date.now() >= deadline) return reject(new Error('orphaned fixture process survived'));
        setTimeout(poll, 20);
      };
      poll();
    });
    expect(() => process.kill(orphanPid, 0)).toThrow(/ESRCH/u);
    expect(
      execFileSync(
        'psql',
        [
          '-X',
          '-At',
          databaseUrl,
          '-c',
          "select count(*) from pg_stat_activity where application_name like 'tryoutflow-integration-supervisor:%'",
        ],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe('0');
  }, 15_000);

  it.each([
    ['SIGTERM', 143],
    ['SIGKILL', 137],
  ] as const)(
    'cleans exact run resources after runner %s',
    async (signal, expectedCode) => {
      const directory = mkdtempSync(join(tmpdir(), `tryoutflow-integration-${signal}-`));
      const output = join(directory, 'run.jsonl');
      const counterKey = createHash('sha256').update(randomUUID()).digest('hex');
      const child = start(output, 30_000, counterKey, {
        fixtureArguments: ['create-owned-resources'],
      });
      await waitForFile(output, /"event":"start"/u);
      const event = JSON.parse(readFileSync(output, 'utf8').trim().split('\n')[0]!) as {
        runId: string;
        databasePrefix: string;
        organizationId: string;
        userId: string;
      };
      const unrelatedOrganizationId = randomUUID();
      const unrelatedUserId = randomUUID();
      const unrelatedCounter = createHash('sha256').update(randomUUID()).digest('hex');
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `insert into auth.users(id) values('${unrelatedUserId}'); insert into public.organizations(id,name,slug) values('${unrelatedOrganizationId}','Unrelated concurrent local write','unrelated-${unrelatedOrganizationId}'); insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${unrelatedCounter}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
      ]);
      child.kill(signal);
      const result = await completion(child);
      if (signal === 'SIGTERM') expect(result.code).toBe(expectedCode);
      else expect(result.signal).toBe('SIGKILL');
      const deadline = Date.now() + 8_000;
      while (
        Date.now() < deadline &&
        ownedFixtureResidue(
          event.runId,
          event.databasePrefix,
          counterKey,
          event.organizationId,
          event.userId,
        ) !== '0|0|0|0|0'
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(
        ownedFixtureResidue(
          event.runId,
          event.databasePrefix,
          counterKey,
          event.organizationId,
          event.userId,
        ),
      ).toBe('0|0|0|0|0');
      expect(
        execFileSync(
          'psql',
          [
            databaseUrl,
            '-At',
            '-c',
            `select (select count(*) from public.organizations where id='${unrelatedOrganizationId}')||'|'||(select count(*) from auth.users where id='${unrelatedUserId}')||'|'||(select count(*) from public.registration_rate_counters where key_hash='${unrelatedCounter}')`,
          ],
          { encoding: 'utf8' },
        ).trim(),
      ).toBe('1|1|1');
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `delete from public.organizations where id='${unrelatedOrganizationId}'; delete from auth.users where id='${unrelatedUserId}'; delete from public.registration_rate_counters where key_hash='${unrelatedCounter}'`,
      ]);
    },
    20_000,
  );

  it('bounds a TERM-ignoring child with KILL and reports the conventional code', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-ignore-term-'));
    const output = join(directory, 'run.jsonl');
    const child = start(output, 30_000, undefined, {
      fixtureArguments: ['ignore-term'],
    });
    await waitForFile(output, /"event":"start"/u);
    child.kill('SIGTERM');
    const startedAt = Date.now();
    const result = await completion(child);
    expect(result.code).toBe(143);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 10_000);

  it('propagates a directly spawned command signal as 128 plus signal number', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-exit-'));
    const output = join(directory, 'run.jsonl');
    const result = await completion(
      start(output, 0, undefined, { fixtureArguments: ['self-kill'] }),
    );
    expect(result.code).toBe(137);
  });

  it('preserves an ordinary failing command exit code', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-failure-'));
    const output = join(directory, 'run.jsonl');
    const result = await completion(start(output, 0, undefined, { fixtureArguments: ['exit-23'] }));
    expect(result.code).toBe(23);
  });
});
