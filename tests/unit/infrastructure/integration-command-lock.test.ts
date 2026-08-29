// @vitest-environment node

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const runner = resolve('scripts/run-integration-tests.mjs');
const fixture = resolve('tests/fixtures/integration-lock/record-run.mjs');

function start(
  output: string,
  holdMilliseconds: number,
  counterKey = createHash('sha256').update(randomUUID()).digest('hex'),
) {
  return spawn(process.execPath, [runner], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SUPABASE_DB_URL: databaseUrl,
      TRYOUTFLOW_INTEGRATION_TEST_COMMAND: JSON.stringify([
        process.execPath,
        fixture,
        output,
        String(holdMilliseconds),
        counterKey,
      ]),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function completion(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; stderr: string }>((resolveCompletion) => {
    let stderr = '';
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('close', (code) => resolveCompletion({ code, stderr }));
  });
}

describe('full integration command database lock', () => {
  it('serializes simultaneous processes instead of overlapping shared fixtures', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-lock-'));
    const output = join(directory, 'runs.jsonl');
    const counterKey = createHash('sha256').update(randomUUID()).digest('hex');
    const first = start(output, 300, counterKey);
    const second = start(output, 300, counterKey);
    const [firstResult, secondResult] = await Promise.all([completion(first), completion(second)]);

    expect(firstResult).toEqual({ code: 0, stderr: '' });
    expect(secondResult).toEqual({ code: 0, stderr: '' });
    const events = readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; pid: number });
    expect(events.map(({ event }) => event)).toEqual(['start', 'end', 'start', 'end']);
    expect(events[0]!.pid).toBe(events[1]!.pid);
    expect(events[2]!.pid).toBe(events[3]!.pid);
    expect(events[0]!.pid).not.toBe(events[2]!.pid);
  });

  it('reclaims a lock session orphaned by forced runner termination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tryoutflow-integration-lock-kill-'));
    const firstOutput = join(directory, 'first.jsonl');
    const recoveryOutput = join(directory, 'recovery.jsonl');
    const first = start(firstOutput, 30_000);

    await new Promise<void>((resolveStart, reject) => {
      const deadline = Date.now() + 5_000;
      const poll = () => {
        try {
          if (readFileSync(firstOutput, 'utf8').includes('start')) return resolveStart();
        } catch {
          // The fixture has not acquired the lock yet.
        }
        if (Date.now() >= deadline) return reject(new Error('first fixture did not start'));
        setTimeout(poll, 20);
      };
      poll();
    });
    const firstExit = new Promise<void>((resolveExit) => first.once('exit', () => resolveExit()));
    first.kill('SIGKILL');
    await firstExit;

    const recovery = start(recoveryOutput, 0);
    const recovered = await completion(recovery);
    expect(recovered).toEqual({ code: 0, stderr: '' });
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
          "select count(*) from pg_stat_activity where application_name like 'tryoutflow-integration-lock:%'",
        ],
        { encoding: 'utf8' },
      ).trim(),
    ).toBe('0');
  }, 15_000);
});
