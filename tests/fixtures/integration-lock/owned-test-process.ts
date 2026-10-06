import type { ChildProcess } from 'node:child_process';

export async function withOwnedTestProcess<T>(
  child: ChildProcess,
  operation: () => Promise<T>,
): Promise<T> {
  const closed =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once('close', () => resolve()));
  try {
    return await operation();
  } finally {
    // Signal only this test's direct runner. Its supervisor owns descendant cleanup.
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  }
}
