import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const toolRoot = fileURLToPath(new URL('../tools/native-deepmerge-backport/', import.meta.url));
const manifestHash = 'b4b9d778d31bf5cd364eba6648a0843dc3756917acef071ad72568b78029b4f1';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stable = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

export function backportManifest() {
  const bytes = readFileSync(resolve(toolRoot, 'manifest.json'));
  if (sha256(bytes) !== manifestHash) throw new Error('Backport approval manifest changed.');
  return JSON.parse(bytes);
}

export function patchDeepmerge(source) {
  const anchors = [
    'function mergeObject(target, source, options) {',
    'getKeys(target).forEach(function(key) {',
    'if (propertyIsUnsafe(target, key)) {',
  ];
  if (anchors.some((anchor) => source.split(anchor).length !== 2))
    throw new Error('Unexpected deepmerge source shape.');
  return source
    .replace(
      anchors[0],
      "function keyIsForbidden(key) {\n\treturn key === '__proto__' || key === 'constructor' || key === 'prototype'\n}\n\n" +
        anchors[0],
    )
    .replace(anchors[1], anchors[1] + '\n\t\t\tif (keyIsForbidden(key)) return')
    .replace(anchors[2], 'if (keyIsForbidden(key) || propertyIsUnsafe(target, key)) {');
}

export function upstreamSnapshot(file) {
  const manifest = backportManifest();
  const entry = manifest.files.find((item) => item.path === file);
  if (!entry) throw new Error('Unknown backport file.');
  const bytes = readFileSync(resolve(toolRoot, entry.snapshot));
  if (sha256(bytes) !== entry.originalSha256) throw new Error('Upstream proof source changed.');
  return bytes.toString();
}

function packageFile(packageRoot, file) {
  const path = resolve(packageRoot, file);
  if (
    !realpathSync(path).startsWith(realpathSync(packageRoot) + sep) ||
    !lstatSync(path).isFile() ||
    lstatSync(path).isSymbolicLink()
  )
    throw new Error('Backport source is not a regular package file.');
  return path;
}

function installation(root, lock) {
  const manifest = backportManifest();
  for (const [name, expected] of Object.entries(manifest.lockedPackages)) {
    const actual = lock?.packages?.[`node_modules/${name}`];
    if (
      !actual ||
      actual.link ||
      actual.inBundle ||
      ['version', 'resolved', 'integrity'].some((key) => actual[key] !== expected[key])
    )
      throw new Error(`Backport dependency provenance changed: ${name}`);
  }
  const packageRoot = resolve(root, 'apps/mobile/node_modules/deepmerge');
  if (!lstatSync(packageRoot).isDirectory() || lstatSync(packageRoot).isSymbolicLink())
    throw new Error('Deepmerge must be an installed registry directory.');
  if (sha256(readFileSync(packageFile(packageRoot, 'package.json'))) !== manifest.packageJsonSha256)
    throw new Error('Deepmerge package identity changed.');
  return { manifest, packageRoot };
}

export function applyDeepmergeBackport(root) {
  const lock = JSON.parse(readFileSync(resolve(root, 'apps/mobile/package-lock.json')));
  const { manifest, packageRoot } = installation(root, lock);
  const sources = manifest.files.map((entry) => {
    const path = packageFile(packageRoot, entry.path);
    const source = readFileSync(path, 'utf8');
    return { ...entry, path, source, hash: sha256(source) };
  });
  if (sources.every((entry) => entry.hash === entry.patchedSha256)) return 'already-patched';
  if (!sources.every((entry) => entry.hash === entry.originalSha256))
    throw new Error(
      'Unknown or partially patched deepmerge installation; reinstall the frozen lockfile.',
    );
  const patches = sources.map((entry) => {
    const patched = patchDeepmerge(entry.source);
    if (sha256(patched) !== entry.patchedSha256) throw new Error('Backport output hash mismatch.');
    return { path: entry.path, patched };
  });
  for (const { path, patched } of patches) {
    const temporary = `${path}.tryoutflow-backport`;
    writeFileSync(temporary, patched, { flag: 'wx' });
    renameSync(temporary, path);
  }
  return 'patched';
}

export function loadMerge(source, filename) {
  const commonJsModule = { exports: {} };
  const context = vm.createContext({ module: commonJsModule, exports: commonJsModule.exports });
  vm.runInContext(source, context, { filename, timeout: 1000 });
  return { merge: commonJsModule.exports, prototype: vm.runInContext('Object.prototype', context) };
}

export function attackResults(merge) {
  const payload = () => JSON.parse('{"__proto__":{"inheritedQAflag":true}}');
  return [
    merge(Object.create(null), payload()),
    merge({ session: null }, { session: payload() }).session,
    merge({ session: 1 }, { session: payload() }).session,
    merge(payload(), {}),
    merge({ session: payload() }, { session: { enabled: true } }).session,
  ];
}

export function verifyMergeBehavior(source, filename, consumerSource) {
  const { merge, prototype } = loadMerge(source, filename);
  for (const result of attackResults(merge)) {
    assert.equal(result.inheritedQAflag, undefined);
    assert.equal(Object.getPrototypeOf(result), prototype);
  }
  assert.equal({}.inheritedQAflag, undefined);
  const unsafe = JSON.parse('{"constructor":{"prototype":{"admin":true}},"prototype":{},"safe":1}');
  for (const result of [merge(unsafe, {}), merge(Object.create(null), unsafe)])
    assert.deepEqual(Object.keys(result), ['safe']);
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const target = { project: { android: { sourceDir: 'android' } }, values: [1] };
  const input = { project: { ios: { sourceDir: 'ios' } }, values: [2] };
  const before = JSON.stringify([target, input]);
  assert.deepEqual(plain(merge(target, input)), {
    project: { android: { sourceDir: 'android' }, ios: { sourceDir: 'ios' } },
    values: [1, 2],
  });
  assert.equal(JSON.stringify([target, input]), before);
  assert.deepEqual(plain(merge(null, { name: 'qa' })), { name: 'qa' });
  assert.deepEqual(plain(merge({ session: 1 }, { session: null })), { session: null });
  const date = new Date('2026-10-27T00:00:00Z');
  const symbol = Symbol('configuration');
  assert.equal(merge({ date }, {}).date, date);
  assert.equal(merge({ [symbol]: 'kept' }, {})[symbol], 'kept');
  assert.deepEqual(
    plain(
      merge(
        { nested: {} },
        { nested: {} },
        {
          customMerge: (key) => (key === 'nested' ? () => ({ custom: true }) : undefined),
        },
      ),
    ),
    { nested: { custom: true } },
  );
  assert.deepEqual(plain(merge.all([{ a: 1 }, { b: 2 }])), { a: 1, b: 2 });
  const commonJsModule = { exports: {} };
  const context = vm.createContext({
    module: commonJsModule,
    exports: commonJsModule.exports,
    require: (name) => {
      if (name !== 'deepmerge') throw new Error('Unexpected consumer dependency.');
      return merge;
    },
  });
  vm.runInContext(consumerSource, context, {
    filename: 'React Native CLI config/merge.js',
    timeout: 1000,
  });
  const consumer = commonJsModule.exports.default;
  assert.deepEqual(plain(consumer(target, input)), {
    project: { android: { sourceDir: 'android' }, ios: { sourceDir: 'ios' } },
    values: [2],
  });
  assert.equal(
    consumer({ session: null }, { session: JSON.parse('{"__proto__":{"inheritedQAflag":true}}') })
      .session.inheritedQAflag,
    undefined,
  );
}

const finding = (value) => ({
  name: value.name,
  severity: value.severity,
  range: value.range,
  nodes: value.nodes,
  via: value.via.map((entry) =>
    typeof entry === 'string'
      ? entry
      : Object.fromEntries(
          ['source', 'name', 'dependency', 'url', 'severity', 'range'].map((key) => [
            key,
            entry[key],
          ]),
        ),
  ),
});

export function verifyDeepmergeBackport(root, audit, lock) {
  if (
    audit?.error ||
    audit?.auditReportVersion !== 2 ||
    !audit?.metadata?.vulnerabilities ||
    !audit?.vulnerabilities
  )
    throw new Error('Incomplete backport registry audit.');
  const { manifest, packageRoot } = installation(root, lock);
  if (
    stable(audit.metadata.vulnerabilities) !== stable(manifest.registryCounts) ||
    stable(Object.keys(audit.vulnerabilities).sort()) !==
      stable(Object.keys(manifest.findings).sort())
  )
    throw new Error('Unexpected findings outside the approved deepmerge backport.');
  for (const [name, expected] of Object.entries(manifest.findings)) {
    if (stable(finding(audit.vulnerabilities[name])) !== stable(finding(expected)))
      throw new Error(`Backport advisory/path drift: ${name}`);
  }
  const consumer = readFileSync(
    resolve(root, 'apps/mobile/node_modules/@react-native-community/cli-config/build/merge.js'),
    'utf8',
  );
  if (sha256(consumer) !== manifest.consumerSha256)
    throw new Error('Native config consumer changed.');
  const files = manifest.files.map((entry) => {
    const source = readFileSync(packageFile(packageRoot, entry.path), 'utf8');
    if (sha256(source) !== entry.patchedSha256)
      throw new Error(`Backport missing or changed: ${entry.path}`);
    if (entry.path !== 'index.js') verifyMergeBehavior(source, entry.path, consumer);
    return { path: entry.path, sha256: entry.patchedSha256 };
  });
  return {
    outcome: 'verified-security-backport',
    registryFindings: audit.metadata.vulnerabilities,
    advisory: 'GHSA-gcqx-w48m-w2h4',
    manifestSha256: manifestHash,
    files,
    behaviorChecks: 18,
  };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('No backport override flags are supported.');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    console.log(
      `Deepmerge security backport: ${applyDeepmergeBackport(root)} (registry findings remain reported).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
