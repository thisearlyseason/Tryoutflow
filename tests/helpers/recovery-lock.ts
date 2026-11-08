/** Deterministic same-origin lock queue for browser recovery tests. */
export function installRecoveryLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, callback: () => unknown) => {
        const next = tail.then(callback);
        tail = next.catch(() => undefined);
        return next;
      },
    },
  });
}
