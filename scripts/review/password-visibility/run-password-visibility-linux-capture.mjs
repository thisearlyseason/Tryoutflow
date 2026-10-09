// Future task-owned Linux runner. This file is review preparation, not capture authorization.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  createWriteStream,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const mode = process.argv[2];
assert.ok(['preflight', 'capture'].includes(mode));
const root = '/review';
const app = '/review/work/app';
const artifacts = '/review/artifacts';
mkdirSync(artifacts, { recursive: true });
const transport = JSON.parse(readFileSync(resolve(root, 'transport-manifest.json')));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const required = (path, hash) =>
  assert.equal(sha(path), hash, 'Frozen source/input drift: ' + path);
for (const entry of transport.base) required(resolve(root, 'base', entry.path), entry.sha256);
for (const entry of transport.afterOverlay)
  required(resolve(root, 'after', entry.path), entry.sha256);
for (const entry of transport.baselines)
  required(resolve(root, 'baselines', entry.path), entry.sha256);
for (const entry of transport.harnesses) required(resolve(root, entry.path), entry.sha256);
const require = createRequire(resolve(app, 'package.json'));
const npmVersion = execFileSync(process.execPath, ['/runtime/npm/bin/npm-cli.js', '--version'], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS },
}).trim();
const browsers = JSON.parse(
  readFileSync(resolve(dirname(require.resolve('playwright-core/package.json')), 'browsers.json')),
).browsers;
const { chromium } = require('@playwright/test');
const executable = chromium.executablePath();
function readVMMemory() {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const bytes = (name) => {
    const match = text.match(new RegExp('^' + name + ':\\s+(\\d+)\\s+kB$', 'm'));
    assert.ok(match, 'VM memory readback missing ' + name);
    return Number(match[1]) * 1024;
  };
  return {
    checkedUTC: new Date().toISOString(),
    totalBytes: bytes('MemTotal'),
    availableBytes: bytes('MemAvailable'),
    minimumBeforeCaptureBytes: 5 * 1024 ** 3,
    scope: 'Shared Docker VM, not the task cgroup',
  };
}
const vmMemory = readVMMemory();
const preflight = {
  vmMemory,
  checkedUTC: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  npm: npmVersion,
  playwright: require('@playwright/test/package.json').version,
  next: require('next/package.json').version,
  chromium: browsers.find((item) => item.name === 'chromium'),
  chromiumExecutablePresent: existsSync(executable),
  headlessShellCachePresent: readdirSync('/ms-playwright').includes('chromium_headless_shell-1234'),
  copiedDependencies: 0,
  sourceProjectionVerified: true,
  captureStarted: false,
};
writeFileSync(
  resolve(artifacts, 'runtime-preflight.json'),
  JSON.stringify(preflight, null, 2) + '\n',
);
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v24.12.0', 'Pinned Node unavailable; stop without downloads.');
assert.equal(npmVersion, '11.12.1');
assert.equal(preflight.playwright, '1.62.1');
assert.equal(preflight.next, '16.3.8');
assert.equal(preflight.chromium.revision, '1234');
assert.equal(preflight.chromium.browserVersion, '151.0.7922.34');
assert.ok(preflight.chromiumExecutablePresent && preflight.headlessShellCachePresent);
for (const name of [
  '@next/swc-linux-x64-gnu',
  '@tailwindcss/oxide-linux-x64-gnu',
  'lightningcss-linux-x64-gnu',
  'sharp',
])
  require(name);
if (mode === 'preflight') process.exit(0);
assert.ok(
  vmMemory.availableBytes >= vmMemory.minimumBeforeCaptureBytes,
  'Shared Docker VM needs at least 5 GiB MemAvailable before capture; no build started.',
);

const env = {
  PATH: process.env.PATH,
  LANG: 'C.UTF-8',
  TMPDIR: '/tmp',
  NODE_OPTIONS: '--import=/review/password-visibility-linux-network-guard.mjs',
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
  XDG_CACHE_HOME: '/review/work/cache',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-password-screenshot-only',
  NEXT_PUBLIC_APP_URL: 'https://task30.e2e.example.test',
  TRYOUTFLOW_BOT_PROTECTION_MODE: 'deterministic-test',
  TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
  TRYOUTFLOW_VISUAL_FIXED_NOW: '2026-08-28T18:05:00.000Z',
  TASK30_LOCAL_REQUEST_ORIGIN: 'http://127.0.0.1:3112',
  ABUSE_PROTECTION_HMAC_SECRET: 'visual-abuse-protection-secret'.padEnd(64, 'a'),
  PUBLIC_REGISTRATION_RATE_LIMIT_SECRET: 'visual-rate-limit-secret'.padEnd(64, 'r'),
};
const nextCLI = resolve(app, 'node_modules/next/dist/bin/next');
const playwrightCLI = resolve(app, 'node_modules/playwright/cli.js');
// Documented Next16.3 production Webpack build, retaining the complete project type check.
// Four approved auth comparisons and four shared-variant cases run per pass.
// This synthetic local build is never deployed.
const buildArgs = ['build', '--webpack'];
// Documented Node heap ceiling leaves room for native allocations and tmpfs inside 4GiB.
const buildNodeOptions = env.NODE_OPTIONS + ' --max-old-space-size=1536';
function memoryReadback() {
  const result = { checkedUTC: new Date().toISOString() };
  for (const name of ['memory.current', 'memory.peak', 'memory.events']) {
    const path = '/sys/fs/cgroup/' + name;
    if (existsSync(path)) result[name] = readFileSync(path, 'utf8').trim();
  }
  return result;
}
const children = new Set();
const summaries = [];
const terminate = (child) => {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
};
function start(args, additions, logfile) {
  const child = spawn(process.execPath, args, {
    cwd: app,
    env: { ...env, ...additions },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  const out = createWriteStream(logfile, { flags: 'wx' });
  let bytes = 0;
  const record = (chunk) => {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) {
      terminate(child);
      return;
    }
    out.write(chunk);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const done = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      out.end();
      children.delete(child);
      accept({ code, signal, logfile, logBytes: bytes });
    });
  });
  return { child, done };
}
async function bounded(operation, remaining) {
  assert.ok(remaining > 0, 'Canonical startup ceiling reached.');
  const timer = setTimeout(() => {
    try {
      process.kill(-operation.child.pid, 'SIGKILL');
    } catch {}
  }, remaining);
  try {
    return await operation.done;
  } finally {
    clearTimeout(timer);
  }
}
function leaves(report) {
  const tests = [];
  function walk(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || [])
        for (const test of spec.tests || []) tests.push({ spec, test });
      walk(suite.suites);
    }
  }
  walk(report.suites);
  return tests;
}
async function cases(phase) {
  const output = resolve(artifacts, phase);
  const result = await bounded(
    start(
      [
        playwrightCLI,
        'test',
        '--config',
        '/review/password-visibility-auth-screenshots.config.mjs',
      ],
      {
        PASSWORD_SCREENSHOT_SOURCE_ROOT: app,
        PASSWORD_SCREENSHOT_OUTPUT: output,
        PASSWORD_SCREENSHOT_JSON_REPORT: resolve(output, 'report.json'),
      },
      resolve(artifacts, phase + '.log'),
    ),
    4 * 60_000 + 30_000,
  );
  const report = JSON.parse(readFileSync(resolve(output, 'report.json')));
  assert.deepEqual(report.errors || [], [], 'Global or teardown errors invalidate capture.');
  const tests = leaves(report);
  assert.equal(
    tests.length,
    8,
    'Exactly four approved auth cases and four shared-variant cases required.',
  );
  const records = [];
  for (const { spec, test } of tests) {
    assert.equal(test.results.length, 1, 'No retries permitted.');
    const run = test.results[0];
    const image = run.attachments?.find((item) => item.name === 'actual-full-page-review');
    assert.ok(image?.path && existsSync(image.path), 'Missing actual review image.');
    assert.ok(
      ['passed', 'failed'].includes(run.status),
      'Skipped/interrupted case is not evidence.',
    );
    assert.equal(
      run.status,
      'passed',
      'Approved references and shared controls must pass without retries or comparison waivers.',
    );
    records.push({
      project: test.projectName,
      title: spec.title,
      status: run.status,
      image: image.path,
      sha256: sha(image.path),
      attachments: (run.attachments || [])
        .filter((item) => item.contentType === 'image/png' && item.path)
        .map((item) => ({ name: item.name, path: item.path, sha256: sha(item.path) })),
    });
  }
  assert.equal(result.code, 0, 'All approved comparisons and shared checks must pass.');
  summaries.push({ phase, result, records });
  return records;
}
async function appPhase(phase, action) {
  const beforeBuild = readVMMemory();
  writeFileSync(
    resolve(artifacts, phase + '-vm-before-build.json'),
    JSON.stringify(beforeBuild, null, 2) + '\n',
  );
  assert.ok(
    beforeBuild.availableBytes >= beforeBuild.minimumBeforeCaptureBytes,
    'Shared Docker VM needs at least 5 GiB MemAvailable before each build; build not started.',
  );
  const deadline = Date.now() + 240_000;
  const build = await bounded(
    start(
      [nextCLI, ...buildArgs],
      { NODE_OPTIONS: buildNodeOptions },
      resolve(artifacts, phase + '-build.log'),
    ),
    deadline - Date.now(),
  );
  writeFileSync(
    resolve(artifacts, phase + '-build-resource-usage.json'),
    JSON.stringify(memoryReadback(), null, 2) + '\n',
  );
  assert.equal(
    build.code,
    0,
    'Scoped auth build failed; no deadline expansion or dependency installation.',
  );
  const server = start(
    [nextCLI, 'start', '--hostname', '127.0.0.1', '--port', '3112'],
    {},
    resolve(artifacts, phase + '-server.log'),
  );
  try {
    while (true) {
      assert.ok(Date.now() < deadline, 'Canonical build/start ceiling exceeded.');
      assert.equal(server.child.exitCode, null);
      try {
        const response = await fetch('http://127.0.0.1:3112/sign-in', {
          redirect: 'error',
          signal: AbortSignal.timeout(Math.min(1_000, deadline - Date.now())),
        });
        await response.arrayBuffer();
        if (response.status === 200) break;
      } catch {}
      await new Promise((accept) => setTimeout(accept, 100));
    }
    await action();
  } finally {
    terminate(server.child);
    await bounded(server, 5_000);
  }
}
function totalBytes(path) {
  let total = 0;
  for (const name of readdirSync(path)) {
    const entry = resolve(path, name);
    const info = statSync(entry);
    total += info.isDirectory() ? totalBytes(entry) : info.size;
  }
  return total;
}
const outputBudget = setInterval(() => {
  if (totalBytes(artifacts) > 512 * 1024 * 1024) {
    for (const child of children) terminate(child);
    throw new Error('Task artifact budget exceeded; no extra disk/resources authorized.');
  }
}, 1_000);
try {
  cpSync(resolve(root, 'base'), app, { recursive: true });
  cpSync(resolve(root, 'after'), app, { recursive: true });
  for (const entry of transport.afterOverlay) required(resolve(app, entry.path), entry.sha256);
  await appPhase('candidate', async () => {
    const first = await cases('candidate-pass1');
    const second = await cases('candidate-pass2');
    assert.deepEqual(
      first.map((item) => [
        item.project,
        item.title,
        item.attachments.map((image) => [image.name, image.sha256]),
      ]),
      second.map((item) => [
        item.project,
        item.title,
        item.attachments.map((image) => [image.name, image.sha256]),
      ]),
      'Separate capture passes are unstable.',
    );
  });
  for (const entry of transport.baselines)
    required(resolve(root, 'baselines', entry.path), entry.sha256);
  writeFileSync(
    resolve(artifacts, 'capture-review-proof.json'),
    JSON.stringify(
      {
        baseCommit: transport.baseCommit,
        candidateSourceManifestSHA256: transport.candidateSourceManifestSHA256,
        capturesPreparedForReview: true,
        visualGatePassed: false,
        snapshotsUpdated: false,
        approvedApplicationSource: true,
        approvedAuthComparisonsPassed: true,
        sharedVariantChecksPassed: true,
        databaseUsed: false,
        summaries,
        buildArgs,
        buildNodeOptions,
        fullCIOrDeployableBuild: false,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  clearInterval(outputBudget);
  for (const child of children) terminate(child);
}
