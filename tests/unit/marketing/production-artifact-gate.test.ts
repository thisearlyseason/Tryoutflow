// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  assertMarketingProductionResponse,
  startOwnedServer,
  stopOwnedServer,
} from '../../../scripts/verify-marketing-production.mjs';

const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/marketing/owned-server.mjs',
);

async function listen(server: ReturnType<typeof createServer>, port = 0): Promise<number> {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener address');
  return address.port;
}

async function close(server: ReturnType<typeof createServer>) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

function fixtureEnvironment(nonce: string) {
  return { ...process.env, MARKETING_GATE_NONCE: nonce };
}

type OwnedServer = Awaited<ReturnType<typeof startOwnedServer>>;

async function startParallelOwnedServers(
  options: Parameters<typeof startOwnedServer>[0][],
  onOwnedServer: (owned: OwnedServer) => void = () => {},
): Promise<OwnedServer[]> {
  const ownedServers = new Set<OwnedServer>();
  const starts = options.map(async (options_) => {
    const owned = await startOwnedServer(options_);
    ownedServers.add(owned);
    onOwnedServer(owned);
    return owned;
  });
  let allStartsSucceeded = false;

  try {
    const servers = await Promise.all(starts);
    allStartsSucceeded = true;
    return servers;
  } finally {
    await Promise.allSettled(starts);
    if (!allStartsSucceeded) {
      await Promise.allSettled([...ownedServers].map(({ child }) => stopOwnedServer(child)));
    }
  }
}

describe('marketing production artifact gate', () => {
  it('rejects a placeholder or wrong canonical origin in a rendered marketing response', () => {
    expect(() =>
      assertMarketingProductionResponse({
        body: '<link rel="canonical" href="https://tryoutflow.example/pricing">',
        path: '/pricing',
        status: 200,
      }),
    ).toThrow(/canonical/i);
  });

  it('rejects a non-static or non-200 response before accepting canonical metadata', () => {
    expect(() =>
      assertMarketingProductionResponse({
        body: '<link rel="canonical" href="https://marketing.tryoutflow.test/pricing">',
        path: '/pricing',
        status: 404,
      }),
    ).toThrow(/status/i);
  });

  it('reproduces a deterministic collision after a candidate port is released', async () => {
    const releasedCandidate = createServer();
    const candidatePort = await listen(releasedCandidate);
    await close(releasedCandidate);

    const collision = createServer();
    await listen(collision, candidatePort);
    try {
      const child = spawn(process.execPath, [fixture], {
        env: { ...fixtureEnvironment('collision'), PORT: String(candidatePort) },
        stdio: 'ignore',
      });
      const [code] = (await once(child, 'close')) as [number | null];
      expect(code).not.toBe(0);
    } finally {
      await close(collision);
    }
  });

  it('uses a child-owned ephemeral listener despite a forced candidate collision', async () => {
    const collision = createServer();
    const blockedPort = await listen(collision);
    const nonce = 'forced-collision-nonce';
    let owned: Awaited<ReturnType<typeof startOwnedServer>> | undefined;
    try {
      owned = await startOwnedServer({
        arguments_: [fixture],
        command: process.execPath,
        environment: fixtureEnvironment(nonce),
      });
      expect(owned.port).not.toBe(blockedPort);
      expect(owned.child.exitCode).toBeNull();
      const response = await fetch(owned.baseUrl);
      expect(response.headers.get('x-marketing-gate-owner')).toBe(nonce);
    } finally {
      if (owned) await stopOwnedServer(owned.child);
      await close(collision);
    }
  });

  it('starts two owned listeners in parallel without probing another process', async () => {
    const firstNonce = 'parallel-first-nonce';
    const secondNonce = 'parallel-second-nonce';
    let servers: OwnedServer[] | undefined;
    try {
      servers = await startParallelOwnedServers(
        [firstNonce, secondNonce].map((nonce) => ({
          arguments_: [fixture],
          command: process.execPath,
          environment: fixtureEnvironment(nonce),
        })),
      );
      expect(new Set(servers.map(({ port }) => port)).size).toBe(2);
      await expect(fetch(servers[0]!.baseUrl)).resolves.toMatchObject({ ok: true });
      await expect(fetch(servers[1]!.baseUrl)).resolves.toMatchObject({ ok: true });
      const responses = await Promise.all(servers.map(({ baseUrl }) => fetch(baseUrl)));
      expect(responses.map((response) => response.headers.get('x-marketing-gate-owner'))).toEqual([
        firstNonce,
        secondNonce,
      ]);
    } finally {
      if (servers) await Promise.allSettled(servers.map(({ child }) => stopOwnedServer(child)));
    }
  });

  it('stops a fulfilled owned listener when a parallel sibling startup rejects', async () => {
    let fulfilled: Awaited<ReturnType<typeof startOwnedServer>> | undefined;
    try {
      await expect(
        startParallelOwnedServers(
          [
            {
              arguments_: [fixture],
              command: process.execPath,
              environment: fixtureEnvironment('partial-start-success'),
            },
            {
              arguments_: ['--eval', 'setTimeout(() => process.exit(3), 400)'],
              command: process.execPath,
              environment: fixtureEnvironment('partial-start-failure'),
            },
          ],
          (owned) => {
            fulfilled = owned;
          },
        ),
      ).rejects.toThrow(/Server child exited with status 3/u);

      expect(fulfilled).toBeDefined();
      await expect(fetch(fulfilled!.baseUrl)).rejects.toThrow();
      expect({
        childExited: fulfilled!.child.exitCode !== null,
        stderrOpen: !fulfilled!.child.stderr!.destroyed,
        stdoutOpen: !fulfilled!.child.stdout!.destroyed,
      }).toEqual({
        childExited: true,
        stderrOpen: false,
        stdoutOpen: false,
      });
    } finally {
      if (fulfilled && fulfilled.child.exitCode === null) {
        await Promise.allSettled([stopOwnedServer(fulfilled.child)]);
      }
    }
  });
});
