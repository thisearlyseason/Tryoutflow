// @vitest-environment node

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
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
    expect(store.readRecoverableManifests()).toEqual([
      { body, cleanupStage: 'active', path: store.manifestPath(runId) },
    ]);

    const serialized = JSON.parse(readFileSync(store.manifestPath(runId), 'utf8')) as {
      body: typeof body;
      authentication: string;
    };
    serialized.body.role = `tryoutflow_run_${'3'.repeat(16)}`;
    writeFileSync(store.manifestPath(runId), JSON.stringify(serialized));
    expect(store.readRecoverableManifests()).toEqual([]);
    expect(readdirSync(store.directory).some((entry) => entry.includes('.quarantine-'))).toBe(true);
  });

  it('persists authenticated cleanup progress without discarding retry evidence', () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-supervisor-stage-'));
    chmodSync(baseDirectory, 0o700);
    const identity = 'a'.repeat(64);
    const runId = 'b'.repeat(16);
    const store = createSupervisorStateStore({ baseDirectory, identity });
    const body = store.manifestBody(runId);
    store.writeManifest(body);
    store.advanceCleanup(runId, 'sessions-terminated');
    store.advanceCleanup(runId, 'fixtures-removed');
    expect(store.readRecoverableManifests()).toEqual([
      expect.objectContaining({ cleanupStage: 'fixtures-removed', body }),
    ]);
    expect(existsSync(store.manifestPath(runId))).toBe(true);
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

  it('accepts only an authentic current-command reaping completion', () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-reaping-proof-'));
    chmodSync(baseDirectory, 0o700);
    const identity = '8'.repeat(64);
    const firstRunId = '9'.repeat(16);
    const secondRunId = 'a'.repeat(16);
    const store = createSupervisorStateStore({ baseDirectory, identity });
    const firstCommand = { nonce: 'b'.repeat(32) };
    const secondCommand = { nonce: 'c'.repeat(32) };
    const firstCapability = 'd'.repeat(32);
    const secondCapability = 'e'.repeat(32);
    store.writeCommand(firstRunId, firstCommand);
    writeFileSync(store.commandCompletionPath(firstRunId, firstCapability), '{"completion":{}}');
    expect(() => store.readCommandCompletion(firstRunId, firstCapability)).toThrow();

    store.writeCommandCompletion(firstRunId, secondCapability, firstCommand);
    expect(store.readCommandCompletion(firstRunId, secondCapability)).toEqual({
      phase: 'command-group-stopped',
      command: firstCommand,
    });
    expect(readFileSync(store.commandCompletionPath(firstRunId, firstCapability), 'utf8')).toBe(
      '{"completion":{}}',
    );

    store.writeCommand(secondRunId, secondCommand);
    writeFileSync(
      store.commandCompletionPath(secondRunId, firstCapability),
      readFileSync(store.commandCompletionPath(firstRunId, secondCapability)),
      { mode: 0o600 },
    );
    expect(() => store.readCommandCompletion(secondRunId, firstCapability)).toThrow(
      /body|stale|capability/u,
    );
  });

  it.each(['directory', 'fifo', 'symlink', 'hardlink', 'oversize', 'permissions'] as const)(
    'rejects a hostile %s completion proof without blocking or deleting it',
    (kind) => {
      const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-hostile-proof-'));
      chmodSync(baseDirectory, 0o700);
      const identity = 'd'.repeat(64);
      const runId = 'e'.repeat(16);
      const store = createSupervisorStateStore({ baseDirectory, identity });
      const command = { nonce: 'f'.repeat(32) };
      const capability = '1'.repeat(32);
      store.writeCommand(runId, command);
      const proof = store.commandCompletionPath(runId, capability);
      const sibling = join(store.directory, 'proof-source');
      if (kind === 'directory') mkdirSync(proof, { mode: 0o700 });
      if (kind === 'fifo') execFileSync('mkfifo', [proof]);
      if (kind === 'symlink') {
        writeFileSync(sibling, '{}', { mode: 0o600 });
        symlinkSync(sibling, proof);
      }
      if (kind === 'hardlink') {
        writeFileSync(sibling, '{}', { mode: 0o600 });
        linkSync(sibling, proof);
      }
      if (kind === 'oversize') writeFileSync(proof, 'x'.repeat(4_097), { mode: 0o600 });
      if (kind === 'permissions') writeFileSync(proof, '{}', { mode: 0o644 });

      const startedAt = Date.now();
      expect(() => store.readCommandCompletion(runId, capability)).toThrow(/unsafe|completion/u);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(existsSync(proof)).toBe(true);
    },
  );

  it('never replaces an existing completion proof during a write race', () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-proof-no-replace-'));
    chmodSync(baseDirectory, 0o700);
    const runId = '1'.repeat(16);
    const store = createSupervisorStateStore({ baseDirectory, identity: '2'.repeat(64) });
    const command = { nonce: '3'.repeat(32) };
    const capability = '4'.repeat(32);
    store.writeCommand(runId, command);
    const proof = store.commandCompletionPath(runId, capability);
    writeFileSync(proof, 'operator evidence', { mode: 0o600 });

    expect(() => store.writeCommandCompletion(runId, capability, command)).toThrow(
      /replace|exist/u,
    );
    expect(readFileSync(proof, 'utf8')).toBe('operator evidence');
  });

  it('rejects a socket completion proof without connecting to it', async () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-socket-proof-'));
    chmodSync(baseDirectory, 0o700);
    const runId = '4'.repeat(16);
    const store = createSupervisorStateStore({ baseDirectory, identity: '5'.repeat(64) });
    store.writeCommand(runId, { nonce: '6'.repeat(32) });
    const capability = '7'.repeat(32);
    const proof = store.commandCompletionPath(runId, capability);
    const shortSocketPath = join(tmpdir(), `tf-${randomUUID()}.sock`);
    const server = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(shortSocketPath, resolveListen);
    });
    renameSync(shortSocketPath, proof);
    try {
      expect(() => store.readCommandCompletion(runId, capability)).toThrow(/unsafe/u);
      expect(existsSync(proof)).toBe(true);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it('rejects completion proof access after the private directory identity changes', () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'tryoutflow-replaced-proof-directory-'));
    chmodSync(baseDirectory, 0o700);
    const identity = '7'.repeat(64);
    const runId = '8'.repeat(16);
    const store = createSupervisorStateStore({ baseDirectory, identity });
    const originalDirectory = `${store.directory}.original`;
    renameSync(store.directory, originalDirectory);
    symlinkSync(originalDirectory, store.directory);

    expect(() => store.readCommandCompletion(runId, '9'.repeat(32))).toThrow(/directory|identity/u);
  });
});

function start(
  output: string,
  holdMilliseconds: number,
  counterKey = createHash('sha256').update(randomUUID()).digest('hex'),
  options: {
    databaseUrl?: string;
    fixtureArguments?: string[];
    fixtureEnvironment?: Record<string, string | undefined>;
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

async function waitForProcess(
  predicate: (record: { pid: number; command: string }) => boolean,
  timeout = 5_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
      .split('\n')
      .map((line) => /^(\s*\d+)\s+(.+)$/u.exec(line))
      .filter(Boolean)
      .map((record) => ({ pid: Number(record![1]), command: record![2]! }))
      .find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('expected process did not appear');
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

function supervisedCounterKey(runId: string, baseKey: string) {
  return createHash('sha256').update(`${runId}|${baseKey}`).digest('hex');
}

function counterSnapshot(counterKey: string) {
  return execFileSync(
    'psql',
    [
      '-X',
      '-At',
      databaseUrl,
      '-c',
      `select row_to_json(counter)::text from public.registration_rate_counters counter where key_hash='${counterKey}'`,
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
  it('preserves unrelated and per-run namespaced durable counters byte-equivalently', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-counter-owner-'));
    const fixtureCounter = createHash('sha256').update(randomUUID()).digest('hex');
    const unrelatedCounter = createHash('sha256').update(randomUUID()).digest('hex');
    let persistedCounter = '';
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${unrelatedCounter}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
    ]);
    try {
      const result = await completion(start(join(directory, 'run.jsonl'), 0, fixtureCounter));
      expect(result).toEqual({ code: 0, signal: null, stderr: '' });
      const event = JSON.parse(
        readFileSync(join(directory, 'run.jsonl'), 'utf8').trim().split('\n')[0]!,
      ) as { counterKey: string };
      persistedCounter = event.counterKey;
      expect(residue('tryoutflow_fixture_never_', event.counterKey)).toBe('0|1');
      expect(residue('tryoutflow_fixture_never_', unrelatedCounter)).toBe('0|1');
    } finally {
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `delete from public.registration_rate_counters where key_hash in('${persistedCounter || fixtureCounter}','${unrelatedCounter}')`,
      ]);
    }
  });

  it('preserves a byte-equivalent inherited counter even when the command targets its exact key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-inherited-counter-'));
    const output = join(directory, 'run.jsonl');
    const result = await completion(
      start(output, 0, createHash('sha256').update(randomUUID()).digest('hex'), {
        fixtureArguments: ['inherited-rate-state'],
      }),
    );
    expect(result.code).toBe(1);
    const event = JSON.parse(readFileSync(output, 'utf8').trim().split('\n')[0]!) as {
      counterKey: string;
      counterSnapshot: string;
    };
    const after = execFileSync(
      'psql',
      [
        '-X',
        '-At',
        databaseUrl,
        '-c',
        `select row_to_json(counter)::text from public.registration_rate_counters counter where key_hash='${event.counterKey}'`,
      ],
      { encoding: 'utf8' },
    ).trim();
    expect(after).toBe(event.counterSnapshot);
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `delete from public.registration_rate_counters where key_hash='${event.counterKey}'`,
    ]);
  });

  it.each(
    [
      'identity-validation',
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
      let phaseRunId = '';
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
        phaseRunId = hook.runId;
        child.kill(signal);
        const result = await completion(child);
        if (signal === 'SIGTERM') expect(result.code).toBe(143);
        else expect(result.signal).toBe('SIGKILL');

        const recovery = await completion(start(join(directory, 'recovery.jsonl'), 0));
        expect(recovery.code).toBe(0);
        const persistedCounter = supervisedCounterKey(hook.runId, fixtureCounter);
        const expectedCounterCount = existsSync(output) ? '1' : '0';
        expect(supervisorResidue(hook.runId, persistedCounter)).toBe(
          `0|${expectedCounterCount}|0|0|0`,
        );
        expect(residue('tryoutflow_fixture_never_', unrelatedCounter)).toBe('0|1');
        if (phaseName !== 'cleanup') expect(existsSync(output)).toBe(false);
      } finally {
        execFileSync('psql', [
          databaseUrl,
          '-c',
          `delete from public.registration_rate_counters where key_hash in('${phaseRunId ? supervisedCounterKey(phaseRunId, fixtureCounter) : fixtureCounter}','${unrelatedCounter}')`,
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
    const staleCounter = createHash('sha256').update(randomUUID()).digest('hex');
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
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${staleCounter}',7,'2099-01-02 03:04:05+00','2099-01-02 03:14:05+00')`,
    ]);
    const staleCounterSnapshot = counterSnapshot(staleCounter);
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
      expect(counterSnapshot(staleCounter)).toBe(staleCounterSnapshot);
    } finally {
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `drop database if exists ${databaseName} with (force)`,
      ]);
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `set session_replication_role=replica; delete from public.organizations where id='${staleOrganizationId}'; reset session_replication_role; delete from auth.users where id='${staleUserId}'; delete from public.registration_rate_counters where key_hash='${staleCounter}'; drop schema if exists ${staleOwnershipSchema} cascade; drop role if exists ${staleRole}`,
      ]);
      rmSync(manifest, { force: true });
    }
  });

  it.each(['pre-spawn', 'spawned-unbound', 'post-spawn', 'active', 'cleanup'] as const)(
    'reaps the exact command group when the supervisor is directly killed during %s',
    async (phaseName) => {
      const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-direct-supervisor-kill-'));
      const output = join(directory, 'command.jsonl');
      const hooks = join(directory, 'hooks.jsonl');
      const unrelated = spawn('sleep', ['30']);
      let persistedCounter = '';
      let beforeCounter = '';
      const child = start(output, phaseName === 'cleanup' ? 0 : 30_000, undefined, {
        hookFile: hooks,
        pausePhase: phaseName,
        fixtureArguments: ['ignore-term'],
      });
      try {
        await waitForFile(hooks, new RegExp(`"phase":"${phaseName}"`, 'u'), 10_000);
        const hook = readFileSync(hooks, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { phase: string; supervisorPid: number })
          .find((entry) => entry.phase === phaseName)!;
        if (phaseName === 'active' || phaseName === 'cleanup') {
          await waitForFile(output, /"event":"start"/u, 10_000);
          persistedCounter = (
            JSON.parse(readFileSync(output, 'utf8').trim().split('\n')[0]!) as {
              counterKey: string;
            }
          ).counterKey;
          beforeCounter = counterSnapshot(persistedCounter);
        }
        process.kill(hook.supervisorPid, 'SIGKILL');
        const result = await completion(child);
        expect(result.code).toBe(137);
        if (existsSync(output)) {
          const event = JSON.parse(readFileSync(output, 'utf8').trim().split('\n')[0]!) as {
            pid: number;
          };
          await expect(
            new Promise<void>((resolveGone, rejectGone) => {
              const deadline = Date.now() + 4_000;
              const poll = () => {
                try {
                  process.kill(event.pid, 0);
                } catch {
                  return resolveGone();
                }
                if (Date.now() >= deadline)
                  return rejectGone(new Error('direct-supervisor child survived'));
                setTimeout(poll, 20);
              };
              poll();
            }),
          ).resolves.toBeUndefined();
        }
        if (persistedCounter) expect(counterSnapshot(persistedCounter)).toBe(beforeCounter);
        expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
      } finally {
        unrelated.kill('SIGKILL');
        child.kill('SIGKILL');
        await completion(start(join(directory, 'recovery.jsonl'), 0));
        if (persistedCounter)
          execFileSync('psql', [
            databaseUrl,
            '-c',
            `delete from public.registration_rate_counters where key_hash='${persistedCounter}'`,
          ]);
      }
    },
    20_000,
  );

  it('retains the canonical lock through direct-supervisor reaping and recovery', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-direct-kill-lock-'));
    const firstOutput = join(directory, 'first.jsonl');
    const secondOutput = join(directory, 'second.jsonl');
    const hooks = join(directory, 'hooks.jsonl');
    const first = start(firstOutput, 30_000, undefined, {
      hookFile: hooks,
      pausePhase: 'active',
      fixtureArguments: ['ignore-term'],
    });
    await waitForFile(firstOutput, /"event":"start"/u, 10_000);
    await waitForFile(hooks, /"phase":"active"/u, 10_000);
    const firstHook = readFileSync(hooks, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { phase: string; runId: string; supervisorPid?: number })
      .find((event) => event.phase === 'active')!;
    process.kill(firstHook.supervisorPid!, 'SIGKILL');
    const second = start(secondOutput, 0, undefined, { hookFile: hooks });
    const [firstResult, secondResult] = await Promise.all([completion(first), completion(second)]);
    expect(firstResult.code).toBe(137);
    expect(secondResult.code).toBe(0);

    const events = readFileSync(hooks, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { phase: string; runId: string });
    const oldStopped = events.findIndex(
      (event) => event.runId === firstHook.runId && event.phase === 'command-group-stopped',
    );
    const newPostLock = events.findIndex(
      (event) => event.runId !== firstHook.runId && event.phase === 'post-lock',
    );
    expect(oldStopped).toBeGreaterThan(-1);
    expect(newPostLock).toBeGreaterThan(oldStopped);
    expect(readFileSync(secondOutput, 'utf8')).toMatch(/"event":"start"/u);

    const counters = [firstOutput, secondOutput].map(
      (path) =>
        (
          JSON.parse(readFileSync(path, 'utf8').trim().split('\n')[0]!) as {
            counterKey: string;
          }
        ).counterKey,
    );
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `delete from public.registration_rate_counters where key_hash in('${counters.join("','")}')`,
    ]);
  }, 20_000);

  it('replaces a killed reaper and proves the predecessor absent before a follower acquires the lock', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-killed-reaper-lock-'));
    const firstOutput = join(directory, 'first.jsonl');
    const secondOutput = join(directory, 'second.jsonl');
    const hooks = join(directory, 'hooks.jsonl');
    const first = start(firstOutput, 30_000, undefined, {
      hookFile: hooks,
      pausePhase: 'active',
      fixtureArguments: ['ignore-term'],
    });
    let predecessorPgid = 0;
    try {
      await waitForFile(firstOutput, /"event":"start"/u, 10_000);
      await waitForFile(hooks, /"phase":"active"/u, 10_000);
      const firstEvent = JSON.parse(readFileSync(firstOutput, 'utf8').trim().split('\n')[0]!) as {
        pid: number;
        runId: string;
      };
      const firstHook = readFileSync(hooks, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { phase: string; runId: string; supervisorPid?: number })
        .find((event) => event.phase === 'active')!;
      predecessorPgid = Number(
        execFileSync('ps', ['-o', 'pgid=', '-p', String(firstEvent.pid)], {
          encoding: 'utf8',
        }).trim(),
      );
      const firstReaper = await waitForProcess(
        ({ command }) =>
          command.includes('integration-command-reaper.mjs') && command.includes(firstEvent.runId),
      );
      process.kill(firstReaper.pid, 'SIGKILL');
      process.kill(firstHook.supervisorPid!, 'SIGKILL');

      const replacementReaper = await waitForProcess(
        ({ pid, command }) =>
          pid !== firstReaper.pid &&
          command.includes('integration-command-reaper.mjs') &&
          command.includes(firstEvent.runId),
      );
      process.kill(replacementReaper.pid, 'SIGKILL');

      const second = start(secondOutput, 0, undefined, { hookFile: hooks });
      const [firstResult, secondResult] = await Promise.all([
        completion(first),
        completion(second),
      ]);
      expect(firstResult.code).toBe(137);
      expect(secondResult.code).toBe(0);
      expect(() => process.kill(firstEvent.pid, 0)).toThrow();

      const events = readFileSync(hooks, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { phase: string; runId: string });
      const oldStopped = events.findIndex(
        (event) => event.runId === firstEvent.runId && event.phase === 'command-group-stopped',
      );
      const newPostLock = events.findIndex(
        (event) => event.runId !== firstEvent.runId && event.phase === 'post-lock',
      );
      expect(oldStopped).toBeGreaterThan(-1);
      expect(newPostLock).toBeGreaterThan(oldStopped);
    } finally {
      first.kill('SIGKILL');
      if (predecessorPgid > 1) {
        try {
          process.kill(-predecessorPgid, 'SIGKILL');
        } catch {
          // The replacement reaper already stopped the exact group.
        }
      }
      await completion(start(join(directory, 'recovery.jsonl'), 0));
      for (const path of [firstOutput, secondOutput]) {
        if (!existsSync(path)) continue;
        const counterKey = (
          JSON.parse(readFileSync(path, 'utf8').trim().split('\n')[0]!) as { counterKey?: string }
        ).counterKey;
        if (counterKey)
          execFileSync('psql', [
            databaseUrl,
            '-c',
            `delete from public.registration_rate_counters where key_hash='${counterKey}'`,
          ]);
      }
    }
  }, 25_000);

  it('quiesces after bounded persistent reaper failures while retaining the lock', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-bounded-reaper-'));
    const firstOutput = join(directory, 'first.jsonl');
    const secondOutput = join(directory, 'second.jsonl');
    const hooks = join(directory, 'hooks.jsonl');
    const first = start(firstOutput, 0, undefined, {
      hookFile: hooks,
      fixtureEnvironment: { TRYOUTFLOW_INTEGRATION_TEST_FORCE_REAPER_FAILURE: '1' },
    });
    let firstStderr = '';
    first.stderr?.setEncoding('utf8').on('data', (chunk: string) => (firstStderr += chunk));
    const unrelated = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)']);
    let persistedCounters: string[] = [];
    try {
      const deadline = Date.now() + 8_000;
      while (!/failed closed after 5 attempts/u.test(firstStderr) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(firstStderr.match(/failed closed after 5 attempts/gu)).toHaveLength(1);
      const reaperStarts = () =>
        readFileSync(hooks, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { phase: string })
          .filter((event) => event.phase === 'reaper-started').length;
      expect(reaperStarts()).toBe(5);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(reaperStarts()).toBe(5);

      const second = start(secondOutput, 0);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(existsSync(secondOutput)).toBe(false);
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();

      first.kill('SIGTERM');
      const [firstResult, secondResult] = await Promise.all([
        completion(first),
        completion(second),
      ]);
      expect(firstResult.code).toBe(143);
      expect(secondResult.code).toBe(0);
      expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
      persistedCounters = [firstOutput, secondOutput].map(
        (path) =>
          (
            JSON.parse(readFileSync(path, 'utf8').trim().split('\n')[0]!) as {
              counterKey: string;
            }
          ).counterKey,
      );
    } finally {
      first.kill('SIGKILL');
      unrelated.kill('SIGTERM');
      if (persistedCounters.length > 0)
        execFileSync('psql', [
          databaseUrl,
          '-c',
          `delete from public.registration_rate_counters where key_hash in('${persistedCounters.join("','")}')`,
        ]);
    }
  }, 20_000);

  it('retains its lock through repeated mixed signals until the exact group is externally absent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-repeated-signal-reaper-'));
    const firstOutput = join(directory, 'first.jsonl');
    const secondOutput = join(directory, 'second.jsonl');
    const hooks = join(directory, 'hooks.jsonl');
    const first = start(firstOutput, 30_000, undefined, {
      hookFile: hooks,
      fixtureArguments: ['ignore-term'],
      fixtureEnvironment: { TRYOUTFLOW_INTEGRATION_TEST_FORCE_REAPER_FAILURE: '1' },
    });
    let firstStderr = '';
    first.stderr?.setEncoding('utf8').on('data', (chunk: string) => (firstStderr += chunk));
    let predecessorPgid = 0;
    let persistedCounters: string[] = [];
    try {
      await waitForFile(firstOutput, /"event":"start"/u, 10_000);
      await waitForFile(hooks, /"phase":"active"/u, 10_000);
      const firstEvent = JSON.parse(readFileSync(firstOutput, 'utf8').trim().split('\n')[0]!) as {
        pid: number;
        counterKey: string;
      };
      persistedCounters.push(firstEvent.counterKey);
      predecessorPgid = Number(
        execFileSync('ps', ['-o', 'pgid=', '-p', String(firstEvent.pid)], {
          encoding: 'utf8',
        }).trim(),
      );
      const active = readFileSync(hooks, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { phase: string; supervisorPid?: number })
        .find((event) => event.phase === 'active')!;
      process.kill(active.supervisorPid!, 'SIGKILL');
      const deadline = Date.now() + 8_000;
      while (!/failed closed after 5 attempts/u.test(firstStderr) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(firstStderr.match(/failed closed after 5 attempts/gu)).toHaveLength(1);

      const second = start(secondOutput, 0);
      for (const signals of [
        Array<NodeJS.Signals>(2).fill('SIGTERM'),
        Array<NodeJS.Signals>(10).fill('SIGINT'),
        Array.from({ length: 100 }, (_, index) => (index % 2 === 0 ? 'SIGTERM' : 'SIGINT')),
      ]) {
        for (const signal of signals) process.kill(first.pid!, signal);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(() => process.kill(first.pid!, 0)).not.toThrow();
        expect(() => process.kill(firstEvent.pid, 0)).not.toThrow();
      }
      expect(existsSync(secondOutput)).toBe(false);
      expect(firstStderr.match(/failed closed after 5 attempts/gu)).toHaveLength(1);

      process.kill(-predecessorPgid, 'SIGKILL');
      predecessorPgid = 0;
      first.kill('SIGTERM');
      const [firstResult, secondResult] = await Promise.all([
        completion(first),
        completion(second),
      ]);
      expect([130, 143]).toContain(firstResult.code);
      expect(secondResult.code).toBe(0);
      persistedCounters.push(
        (
          JSON.parse(readFileSync(secondOutput, 'utf8').trim().split('\n')[0]!) as {
            counterKey: string;
          }
        ).counterKey,
      );
    } finally {
      first.kill('SIGKILL');
      if (predecessorPgid > 1) {
        try {
          process.kill(-predecessorPgid, 'SIGKILL');
        } catch {
          // The exact command group is already absent.
        }
      }
      await completion(start(join(directory, 'recovery.jsonl'), 0));
      if (persistedCounters.length > 0)
        execFileSync('psql', [
          databaseUrl,
          '-c',
          `delete from public.registration_rate_counters where key_hash in('${persistedCounters.join("','")}')`,
        ]);
    }
  }, 25_000);

  it('retains hostile immutable proof evidence and succeeds through a fresh attempt path', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-immutable-reaper-proof-'));
    const firstOutput = join(directory, 'first.jsonl');
    const secondOutput = join(directory, 'second.jsonl');
    const hooks = join(directory, 'hooks.jsonl');
    const first = start(firstOutput, 30_000, undefined, {
      hookFile: hooks,
      pausePhase: 'active',
      fixtureArguments: ['ignore-term'],
    });
    let proof = '';
    let persistedCounters: string[] = [];
    try {
      await waitForFile(firstOutput, /"event":"start"/u, 10_000);
      await waitForFile(hooks, /"phase":"active"/u, 10_000);
      await waitForFile(hooks, /"phase":"reaper-started"/u, 10_000);
      const events = readFileSync(hooks, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              phase: string;
              runId: string;
              supervisorPid?: number;
              completionCapability?: string;
            },
        );
      const active = events.find((event) => event.phase === 'active')!;
      const reaper = events.find((event) => event.phase === 'reaper-started')!;
      const validated = resolveAndValidateLocalDatabase(databaseUrl);
      const store = createSupervisorStateStore({ identity: validated.identity });
      proof = store.commandCompletionPath(reaper.runId, reaper.completionCapability!);
      execFileSync('mkfifo', [proof]);

      process.kill(active.supervisorPid!, 'SIGKILL');
      const second = start(secondOutput, 0, undefined, { hookFile: hooks });
      const [firstResult, secondResult] = await Promise.all([
        completion(first),
        completion(second),
      ]);
      expect(firstResult.code).toBe(137);
      expect(secondResult.code).toBe(0);
      expect(existsSync(proof)).toBe(true);

      const finalEvents = readFileSync(hooks, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { phase: string; runId: string });
      const oldStopped = finalEvents.findIndex(
        (event) => event.runId === active.runId && event.phase === 'command-group-stopped',
      );
      const followerPostLock = finalEvents.findIndex(
        (event) => event.runId !== active.runId && event.phase === 'post-lock',
      );
      expect(oldStopped).toBeGreaterThan(-1);
      expect(followerPostLock).toBeGreaterThan(oldStopped);
      persistedCounters = [firstOutput, secondOutput].map(
        (path) =>
          (
            JSON.parse(readFileSync(path, 'utf8').trim().split('\n')[0]!) as {
              counterKey: string;
            }
          ).counterKey,
      );
    } finally {
      first.kill('SIGKILL');
      if (proof) rmSync(proof, { force: true });
      await completion(start(join(directory, 'recovery.jsonl'), 0));
      if (persistedCounters.length > 0)
        execFileSync('psql', [
          databaseUrl,
          '-c',
          `delete from public.registration_rate_counters where key_hash in('${persistedCounters.join("','")}')`,
        ]);
    }
  }, 25_000);

  it('fails closed on lost launcher identity until the exact old group is externally absent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-reaper-identity-failure-'));
    const firstOutput = join(directory, 'first.jsonl');
    const secondOutput = join(directory, 'second.jsonl');
    const hooks = join(directory, 'hooks.jsonl');
    const first = start(firstOutput, 30_000, undefined, {
      hookFile: hooks,
      pausePhase: 'active',
      fixtureArguments: ['ignore-term'],
    });
    let predecessorPgid = 0;
    let persistedCounters: string[] = [];
    try {
      await waitForFile(firstOutput, /"event":"start"/u, 10_000);
      await waitForFile(hooks, /"phase":"active"/u, 10_000);
      const firstEvent = JSON.parse(readFileSync(firstOutput, 'utf8').trim().split('\n')[0]!) as {
        pid: number;
        runId: string;
        counterKey: string;
      };
      persistedCounters.push(firstEvent.counterKey);
      const hook = readFileSync(hooks, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { phase: string; supervisorPid?: number })
        .find((event) => event.phase === 'active')!;
      const processFields = execFileSync(
        'ps',
        ['-o', 'ppid=,pgid=', '-p', String(firstEvent.pid)],
        { encoding: 'utf8' },
      )
        .trim()
        .split(/\s+/u)
        .map(Number);
      const launcherPid = processFields[0]!;
      predecessorPgid = processFields[1]!;
      process.kill(launcherPid, 'SIGKILL');
      process.kill(hook.supervisorPid!, 'SIGKILL');

      const second = start(secondOutput, 0, undefined, { hookFile: hooks });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(existsSync(secondOutput)).toBe(false);
      expect(() => process.kill(firstEvent.pid, 0)).not.toThrow();

      process.kill(-predecessorPgid, 'SIGKILL');
      predecessorPgid = 0;
      const [firstResult, secondResult] = await Promise.all([
        completion(first),
        completion(second),
      ]);
      expect(firstResult.code).toBe(137);
      expect(secondResult.code).toBe(0);
      const secondEvent = JSON.parse(readFileSync(secondOutput, 'utf8').trim().split('\n')[0]!) as {
        counterKey: string;
      };
      persistedCounters.push(secondEvent.counterKey);
    } finally {
      first.kill('SIGKILL');
      if (predecessorPgid > 1) {
        try {
          process.kill(-predecessorPgid, 'SIGKILL');
        } catch {}
      }
      await completion(start(join(directory, 'recovery.jsonl'), 0));
      if (persistedCounters.length > 0)
        execFileSync('psql', [
          databaseUrl,
          '-c',
          `delete from public.registration_rate_counters where key_hash in('${persistedCounters.join("','")}')`,
        ]);
    }
  }, 25_000);

  it.each(['databases', 'roots', 'registry'] as const)(
    'retains authenticated retry state when cleanup fails at %s',
    async (cleanupStage) => {
      const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-cleanup-retry-'));
      const output = join(directory, 'command.jsonl');
      const failed = await completion(
        start(output, 0, undefined, {
          fixtureArguments: ['create-owned-resources'],
          fixtureEnvironment: {
            TRYOUTFLOW_INTEGRATION_TEST_FAIL_CLEANUP_STAGE: cleanupStage,
          },
        }),
      );
      expect(failed.code).toBe(1);
      const event = JSON.parse(readFileSync(output, 'utf8').trim().split('\n')[0]!) as {
        runId: string;
        databasePrefix: string;
        organizationId: string;
        userId: string;
        counterKey: string;
      };
      const validated = resolveAndValidateLocalDatabase(databaseUrl);
      const store = createSupervisorStateStore({ identity: validated.identity });
      expect(existsSync(store.manifestPath(event.runId))).toBe(true);
      const recovered = await completion(start(join(directory, 'recovery.jsonl'), 0));
      expect(recovered.code).toBe(0);
      expect(
        ownedFixtureResidue(
          event.runId,
          event.databasePrefix,
          event.counterKey,
          event.organizationId,
          event.userId,
        ),
      ).toBe('0|1|0|0|0');
      expect(existsSync(store.manifestPath(event.runId))).toBe(false);
      execFileSync('psql', [
        databaseUrl,
        '-c',
        `delete from public.registration_rate_counters where key_hash='${event.counterKey}'`,
      ]);
    },
    20_000,
  );

  it('cleans exact roots while retaining namespaced counters after runner SIGTERM', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-SIGTERM-'));
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
      counterKey: string;
    };
    const unrelatedOrganizationId = randomUUID();
    const unrelatedUserId = randomUUID();
    const unrelatedCounter = createHash('sha256').update(randomUUID()).digest('hex');
    execFileSync('psql', [
      databaseUrl,
      '-c',
      `insert into auth.users(id) values('${unrelatedUserId}'); insert into public.organizations(id,name,slug) values('${unrelatedOrganizationId}','Unrelated concurrent local write','unrelated-${unrelatedOrganizationId}'); insert into public.registration_rate_counters(key_hash,attempts,window_started_at,expires_at) values('${unrelatedCounter}',1,clock_timestamp(),clock_timestamp()+interval '10 minutes')`,
    ]);
    const retainedCounterSnapshot = counterSnapshot(event.counterKey);
    child.kill('SIGTERM');
    const result = await completion(child);
    expect(result.code).toBe(143);
    const deadline = Date.now() + 8_000;
    while (
      Date.now() < deadline &&
      ownedFixtureResidue(
        event.runId,
        event.databasePrefix,
        event.counterKey,
        event.organizationId,
        event.userId,
      ) !== '0|1|0|0|0'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(
      ownedFixtureResidue(
        event.runId,
        event.databasePrefix,
        event.counterKey,
        event.organizationId,
        event.userId,
      ),
    ).toBe('0|1|0|0|0');
    expect(counterSnapshot(event.counterKey)).toBe(retainedCounterSnapshot);
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
      `delete from public.organizations where id='${unrelatedOrganizationId}'; delete from auth.users where id='${unrelatedUserId}'; delete from public.registration_rate_counters where key_hash in('${unrelatedCounter}','${event.counterKey}')`,
    ]);
  }, 20_000);

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
