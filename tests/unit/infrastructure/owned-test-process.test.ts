// @vitest-environment node

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

import { expect, it } from 'vitest';

import { withOwnedTestProcess } from '../../fixtures/integration-lock/owned-test-process';

async function startWaitingChild() {
  const child = spawn(
    process.execPath,
    ['-e', "console.log('ready'); setInterval(() => {}, 1000)"],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  await once(child.stdout!, 'data');
  return child;
}

async function stopFixture(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  await closed;
}

it('reaps its exact child before reporting a fixture startup failure and preserves unrelated children', async () => {
  const child = await startWaitingChild();
  const unrelated = await startWaitingChild();
  const failure = new Error('fixture startup deadline exceeded');
  try {
    await expect(
      withOwnedTestProcess(child, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(() => process.kill(child.pid!, 0)).toThrow();
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
  } finally {
    await Promise.all([stopFixture(child), stopFixture(unrelated)]);
  }
});

it('preserves a normally completed child result without waiting for another close event', async () => {
  const child = await startWaitingChild();
  await stopFixture(child);
  await expect(withOwnedTestProcess(child, async () => 23)).resolves.toBe(23);
});
