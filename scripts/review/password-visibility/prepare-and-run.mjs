// Review-only CI transport. It never changes the active binding or tracked PNGs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const controls = dirname(fileURLToPath(import.meta.url));
const controlRoot = resolve(controls, '../../..');
const base = resolve(process.env.REVIEW_BASE_ROOT);
const output = resolve(process.env.REVIEW_OUTPUT_ROOT);
const artifacts = resolve(output, 'artifacts');
const review = resolve(output, 'input');
const image =
  'mcr.microsoft.com/playwright@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e';
const approvedBase = '8c107546f6f2ab40e5c93c64b85457839e4dfb1a';
const approvedManifest = '09fcd95181a1f5885341cf0186fbe6388dbc0ae0426be009570479dc21c19d47';
const projectionManifest = 'c0fd9baf05e7a6f0beb5278510a51377fd88eb851ba172e4797b6118111e34d3';
const name = 'tryoutflow-password-auth-review-ci-' + process.env.GITHUB_RUN_ID;
assert.match(name, /^tryoutflow-password-auth-review-ci-\d+$/);
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v24.12.0');
assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/tryoutflow-offline-preconditions-oct7');
mkdirSync(artifacts, { recursive: true });
const proof = {
  startedUTC: new Date().toISOString(),
  reviewOnly: true,
  baseCommit: approvedBase,
  baseManifestSHA256: approvedManifest,
  candidateManifestSHA256: projectionManifest,
  captureStarted: false,
  currentBindingReplaced: false,
  snapshotsUpdated: false,
  stages: [],
};
const save = () =>
  writeFileSync(resolve(artifacts, 'ci-review-proof.json'), JSON.stringify(proof, null, 2) + '\n');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = (path) => sha(readFileSync(path));
const checkedPath = (root, path) => {
  assert.ok(!isAbsolute(path) && path && !path.split('/').includes('..'), 'Unsafe transport path');
  return resolve(root, path);
};
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 ** 2,
    ...options,
  });
  if (options.logfile)
    writeFileSync(options.logfile, (result.stdout || '') + (result.stderr || ''));
  assert.ok(!result.error, 'Review subprocess failed: ' + command);
  assert.equal(result.status, 0, 'Review subprocess failed: ' + command + ' exit ' + result.status);
  return (result.stdout || '').trim();
};
function availableMemory() {
  const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  assert.ok(match, 'VM MemAvailable missing');
  return Number(match[1]) * 1024;
}
function recordResources(stage) {
  const disk = statfsSync(output);
  const record = {
    stage,
    observedUTC: new Date().toISOString(),
    availableMemoryBytes: availableMemory(),
    minimumMemoryBytes: 5 * 1024 ** 3,
    freeDiskBytes: disk.bavail * disk.bsize,
    minimumCIDiskBytes: 4 * 1024 ** 3,
  };
  proof.resources ||= [];
  proof.resources.push(record);
  save();
  assert.ok(
    record.availableMemoryBytes >= record.minimumMemoryBytes,
    '5GiB VM memory guard failed; no build',
  );
  // This disposable CI disk is separate from the unchanged30GiB Mac reserve.
  // At most1GiB task output leaves3GiB runner reserve after setup is complete.
  assert.ok(
    record.freeDiskBytes >= record.minimumCIDiskBytes,
    'Disposable runner disk budget failed',
  );
}
function copyChecked(from, to, entry) {
  const source = checkedPath(from, entry.path);
  assert.equal(fileHash(source), entry.sha256, 'Frozen source/input drift: ' + entry.path);
  const target = checkedPath(to, entry.path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

try {
  save();
  assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: base }), approvedBase);
  const { verifyRelease, releaseSourceFiles } = await import(
    pathToFileURL(resolve(base, 'scripts/current-release-dependency-audit.mjs'))
  );
  const bindingPath = resolve(base, 'docs/security/current-release-audit-binding.json');
  const bindingHash = fileHash(bindingPath);
  const binding = JSON.parse(readFileSync(bindingPath));
  assert.equal(binding.releaseManifestSHA256, approvedManifest);
  verifyRelease(base, binding);
  assert.equal(binding.files.length, 1742);
  assert.throws(() => verifyRelease(controlRoot, binding), /exception is inactive for this source/);
  proof.existingReviewBranchBindingRejectionPreserved = true;

  const transportPath = resolve(controls, 'transport-manifest.json');
  assert.equal(
    fileHash(transportPath),
    '59a6f02ec7341e7f700238e7c831a5e36427ea45046ecd925b7d228b19ccbb23',
  );
  const transport = JSON.parse(readFileSync(transportPath));
  assert.equal(transport.baseCommit, approvedBase);
  assert.equal(transport.candidateSourceManifestSHA256, projectionManifest);
  assert.equal(transport.base.length, 681);
  assert.equal(transport.afterOverlay.length, 4);
  assert.equal(transport.baselines.length, 4);
  assert.equal(transport.harnesses.length, 4);
  for (const entry of transport.base) copyChecked(base, resolve(review, 'base'), entry);
  // Baselines are mounted at the wrapper's unchanged relative snapshot paths.
  for (const entry of transport.baselines)
    copyChecked(
      resolve(base, 'tests/e2e/visual/__snapshots__'),
      resolve(review, 'baselines'),
      entry,
    );
  for (const entry of transport.harnesses) copyChecked(controls, review, entry);
  copyFileSync(transportPath, resolve(review, 'transport-manifest.json'));

  const patch = resolve(controls, 'password-visibility-web-forward.patch');
  assert.equal(fileHash(patch), '90dfc6f20dd04260fbd9fa37ab92a91ca032ebe114a0b530fe02e29d60017c90');
  run('git', ['apply', '--check', patch], { cwd: base });
  run('git', ['apply', patch], { cwd: base });
  const projected = releaseSourceFiles(base);
  assert.equal(projected.length, 1744);
  assert.equal(sha(JSON.stringify(projected)), projectionManifest);
  assert.throws(() => verifyRelease(base, binding), /exception is inactive for this source/);
  proof.unapprovedPasswordProjectionBindingRejected = true;
  for (const entry of transport.afterOverlay) copyChecked(base, resolve(review, 'after'), entry);
  assert.equal(fileHash(bindingPath), bindingHash, 'Active binding must remain unchanged');
  proof.baseAndProjectionFullSourceVerified = true;

  const nodeRoot = resolve(dirname(process.execPath), '..');
  const npmRoot = resolve(process.env.COREPACK_HOME, 'v1/npm/11.12.1');
  assert.equal(JSON.parse(readFileSync(resolve(npmRoot, 'package.json'))).version, '11.12.1');
  proof.runtime = {
    node: process.version,
    npm: '11.12.1',
    image,
    dependenciesCopied: 0,
    baselineHashesUnchanged: true,
    sourceControlRoot: relative(controlRoot, controls),
  };
  recordResources('before-image-setup');
  console.log(
    'Fetching exact public Linux amd64 runtime; no provider credentials or local Docker used.',
  );
  run('docker', ['pull', '--platform=linux/amd64', image], {
    logfile: resolve(artifacts, 'pinned-runtime-pull.log'),
  });
  recordResources('before-runtime-preflight');
  // Nested mounts need existing destinations inside the read-only input bind.
  mkdirSync(resolve(review, 'work'), { recursive: true });
  mkdirSync(resolve(review, 'artifacts'), { recursive: true });
  // Use only the ephemeral runner's public system fonts, never home/user fonts.
  const fontDirectories = ['/usr/share/fonts', '/etc/fonts', '/usr/share/fontconfig'];
  if (existsSync('/usr/local/share/fonts')) fontDirectories.push('/usr/local/share/fonts');
  for (const path of fontDirectories) assert.ok(statSync(path).isDirectory());
  const fontPatterns = ['system-ui', 'system-ui:weight=bold', 'sans-serif'];
  const fontFormat = '%{family}|%{style}|%{file}';
  const hostFonts = fontPatterns.map((pattern) => {
    const selection = run('fc-match', ['-f', fontFormat, pattern]);
    const path = selection.split('|').at(-1);
    assert.ok(
      ['/usr/share/fonts/', '/usr/local/share/fonts/'].some((root) => path.startsWith(root)),
      'Selected font must be a public system font',
    );
    return { pattern, selection, sha256: fileHash(path) };
  });
  const flags = [
    'run',
    '--rm',
    '--pull=never',
    '--platform=linux/amd64',
    '--name=' + name,
    '--network=none',
    '--read-only',
    '--memory=4g',
    '--cpus=4',
    '--shm-size=1g',
    '--tmpfs=/tmp:rw,size=536870912',
    '--tmpfs=/review/work:rw,size=1610612736',
    '--mount',
    `type=bind,source=${review},target=/review,readonly`,
    '--mount',
    `type=bind,source=${resolve(base, 'node_modules')},target=/review/work/app/node_modules,readonly`,
    '--mount',
    `type=bind,source=${resolve(review, 'baselines')},target=/review/work/app/tests/e2e/visual/__snapshots__,readonly`,
    '--mount',
    `type=bind,source=${npmRoot},target=/runtime/npm,readonly`,
    '--mount',
    `type=bind,source=${artifacts},target=/review/artifacts`,
    '--mount',
    `type=bind,source=${nodeRoot},target=/runtime/node,readonly`,
    ...fontDirectories.flatMap((path) => [
      '--mount',
      `type=bind,source=${path},target=${path},readonly`,
    ]),
    '--env=PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    '--env=NODE_OPTIONS=--import=/review/password-visibility-linux-network-guard.mjs',
    '--env=PATH=/runtime/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    '--entrypoint=/runtime/node/bin/node',
    image,
    '/review/run-password-visibility-linux-capture.mjs',
  ];
  const fontProbe = `const {execFileSync}=require('node:child_process');
    const {readFileSync}=require('node:fs'); const {createHash}=require('node:crypto');
    console.log(JSON.stringify(${JSON.stringify(fontPatterns)}.map(pattern=>{
      const selection=execFileSync('fc-match',['-f',${JSON.stringify(fontFormat)},pattern],{encoding:'utf8'}).trim();
      return {pattern,selection,sha256:createHash('sha256').update(readFileSync(selection.split('|').at(-1))).digest('hex')};
    })));`;
  recordResources('before-font-parity-preflight');
  assert.equal(run('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']), '');
  const containerFonts = JSON.parse(
    run('docker', [...flags.slice(0, -1), '-e', fontProbe], {
      logfile: resolve(artifacts, 'font-parity-docker.log'),
    }),
  );
  assert.deepEqual(containerFonts, hostFonts, 'System font selection differs from the runner');
  proof.fontEnvironment = {
    directories: fontDirectories,
    hostFonts,
    containerFonts,
    matched: true,
  };
  save();
  for (const mode of ['preflight', 'capture']) {
    recordResources('before-' + mode);
    assert.equal(run('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$']), '');
    const stage = { mode, startedUTC: new Date().toISOString(), memoryGiB: 4, cpus: 4 };
    proof.stages.push(stage);
    save();
    if (mode === 'capture') proof.captureStarted = true;
    console.log('Starting unchanged ' + mode + ' with4GiB/4CPU, one worker, retries0.');
    run('docker', [...flags, mode], { logfile: resolve(artifacts, mode + '-docker.log') });
    stage.completedUTC = new Date().toISOString();
    save();
  }
  for (const entry of transport.baselines)
    assert.equal(
      fileHash(checkedPath(resolve(base, 'tests/e2e/visual/__snapshots__'), entry.path)),
      entry.sha256,
    );
  assert.equal(fileHash(bindingPath), bindingHash);
  proof.status =
    'Four source cases before and twice after captured; artifacts for review only, no release approval';
} catch (error) {
  proof.status = 'Blocked; original failure preserved, no retry or gate waiver';
  proof.blocker = error.message;
  process.exitCode = 1;
} finally {
  const present = spawnSync('docker', ['ps', '-aq', '--filter', 'name=^/' + name + '$'], {
    encoding: 'utf8',
  });
  if (present.status === 0 && present.stdout.trim()) {
    const cleanup = spawnSync('docker', ['stop', '--timeout=30', name], { encoding: 'utf8' });
    proof.ownedContainerCleanupExitCode = cleanup.status;
  }
  proof.completedUTC = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      status: proof.status,
      blocker: proof.blocker,
      completedUTC: proof.completedUTC,
    }),
  );
}
