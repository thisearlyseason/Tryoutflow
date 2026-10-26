export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const original = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== '127.0.0.1' || url.port !== '3201') {
      throw new Error('Fictional route fixture denied non-owned-loopback transport');
    }
    return original(input, { ...init, redirect: 'error' });
  }) as typeof fetch;
}
