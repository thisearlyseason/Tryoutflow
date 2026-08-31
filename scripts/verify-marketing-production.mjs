import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

export const MARKETING_PRODUCTION_ORIGIN = 'https://marketing.tryoutflow.test';
export const MARKETING_PATHS = [
  '/',
  '/features',
  '/for/teams',
  '/for/clubs',
  '/for/associations',
  '/pricing',
  '/demo',
  '/privacy',
  '/terms',
];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nextBinary = resolve(repositoryRoot, 'node_modules/next/dist/bin/next');

export function assertMarketingProductionResponse({ body, path, status }) {
  assert.equal(status, 200, `Expected ${path} to return status 200, received ${status}`);
  const expectedCanonical = `${MARKETING_PRODUCTION_ORIGIN}${path}`;
  assert.ok(
    body.includes(`<link rel="canonical" href="${expectedCanonical}"`),
    `Expected ${path} to contain exact canonical ${expectedCanonical}`,
  );
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'Expected a TCP listener address');
  return address.port;
}

async function closeServer(server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

async function availablePort() {
  const server = createServer();
  try {
    return await listen(server);
  } finally {
    await closeServer(server);
  }
}

function run(command, arguments_, environment) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('close', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${arguments_.join(' ')} exited with status ${code}`));
    });
  });
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with status ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The server has not accepted connections yet.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for next start');
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  const stoppedGracefully = await Promise.race([
    closed.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!stoppedGracefully) {
    child.kill('SIGKILL');
    await closed;
  }
}

async function assertStaticMarketingRoutes() {
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, '.next/prerender-manifest.json'), 'utf8'),
  );
  for (const path of MARKETING_PATHS) {
    assert.ok(manifest.routes[path], `Expected ${path} to be statically prerendered`);
  }
}

export async function runMarketingProductionArtifactGate() {
  const supabaseRequests = [];
  const supabaseServer = createServer((request, response) => {
    supabaseRequests.push(request.url);
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end('{"message":"marketing pages must not use Supabase"}');
  });
  const supabasePort = await listen(supabaseServer);
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_PUBLIC_APP_URL: MARKETING_PRODUCTION_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'production-artifact-gate-key',
  };
  let server;

  try {
    await run(process.execPath, [nextBinary, 'build'], environment);
    await assertStaticMarketingRoutes();

    const port = await availablePort();
    server = spawn(
      process.execPath,
      [nextBinary, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
      {
        cwd: repositoryRoot,
        env: environment,
        stdio: 'inherit',
      },
    );
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(server, baseUrl);

    for (const path of MARKETING_PATHS) {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      const body = await response.text();
      assertMarketingProductionResponse({ body, path, status: response.status });
      assert.equal(
        response.headers.get('set-cookie'),
        null,
        `Expected ${path} not to set auth cookies`,
      );
    }
    assert.deepEqual(supabaseRequests, [], 'Marketing routes unexpectedly called Supabase');

    for (const path of ['/pricing.json', '/not-a-marketing-route']) {
      const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      assert.equal(
        response.status,
        404,
        `Expected near-miss ${path} to remain protected/non-public`,
      );
    }
  } finally {
    if (server) await stop(server);
    await closeServer(supabaseServer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMarketingProductionArtifactGate();
}
