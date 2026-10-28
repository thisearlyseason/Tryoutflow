import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyNativeReleaseAudit } from '../current-release-native-audit.mjs';
import {
  backportManifest,
  patchDeepmerge,
  upstreamSnapshot,
  applyDeepmergeBackport,
  verifyDeepmergeBackport,
  loadMerge,
  attackResults,
  verifyMergeBehavior,
} from '../native-deepmerge-backport.mjs';

const manifest = backportManifest();
const upstream = fileURLToPath(
  new URL('../../tools/native-deepmerge-backport/upstream/', import.meta.url),
);
const consumer = readFileSync(join(upstream, 'cli-config-merge.js.snapshot'), 'utf8');
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'tryoutflow-deepmerge-proof-'));
  const packageRoot = join(root, 'apps/mobile/node_modules/deepmerge');
  const lock = { lockfileVersion: 3, packages: { '': {} } };
  for (const [name, entry] of Object.entries(manifest.lockedPackages))
    lock.packages[`node_modules/${name}`] = structuredClone(entry);
  const audit = {
    auditReportVersion: 2,
    metadata: { vulnerabilities: structuredClone(manifest.registryCounts) },
    vulnerabilities: structuredClone(manifest.findings),
  };
  try {
    for (const entry of manifest.files) {
      const path = join(packageRoot, entry.path);
      mkdirSync(resolve(path, '..'), { recursive: true });
      writeFileSync(path, upstreamSnapshot(entry.path));
    }
    writeFileSync(
      join(packageRoot, 'package.json'),
      readFileSync(join(upstream, 'package.json.snapshot')),
    );
    const consumerPath = join(
      root,
      'apps/mobile/node_modules/@react-native-community/cli-config/build/merge.js',
    );
    mkdirSync(resolve(consumerPath, '..'), { recursive: true });
    writeFileSync(consumerPath, consumer);
    writeFileSync(join(root, 'apps/mobile/package-lock.json'), JSON.stringify(lock));
    run({ root, packageRoot, lock, audit, consumerPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const file of ['dist/cjs.js', 'dist/umd.js']) {
  test(`${file}: original reproduces all five returned-prototype attacks`, () => {
    for (const result of attackResults(loadMerge(upstreamSnapshot(file), file).merge)) {
      assert.equal(result.inheritedQAflag, true);
      assert.equal(Object.hasOwn(result, 'inheritedQAflag'), false);
    }
    assert.equal({}.inheritedQAflag, undefined);
  });
  test(`${file}: actual backport blocks attacks and preserves the published CLI consumer`, () => {
    verifyMergeBehavior(patchDeepmerge(upstreamSnapshot(file)), file, consumer);
  });
}
test('original vulnerable installed sources cannot pass with the approved audit metadata', () =>
  fixture(({ root, audit, lock }) => {
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock), /Backport missing or changed/);
  }));
test('installation is hash-pinned, idempotent and retains genuine package identity and audit counts', () =>
  fixture(({ root, packageRoot, audit, lock }) => {
    const before = readFileSync(join(packageRoot, 'package.json'));
    assert.equal(applyDeepmergeBackport(root), 'patched');
    assert.equal(applyDeepmergeBackport(root), 'already-patched');
    assert.deepEqual(readFileSync(join(packageRoot, 'package.json')), before);
    assert.equal(verifyNativeReleaseAudit(root, audit, lock), 'verified-security-backport');
    assert.equal(audit.metadata.vulnerabilities.low, 4);
    assert.equal(audit.metadata.vulnerabilities.total, 4);
    assert.equal(verifyDeepmergeBackport(root, audit, lock).behaviorChecks, 18);
  }));
test('unknown original source aborts before any file is patched', () =>
  fixture(({ root, packageRoot }) => {
    const cjs = readFileSync(join(packageRoot, 'dist/cjs.js'));
    writeFileSync(join(packageRoot, 'index.js'), 'unreviewed source');
    assert.throws(() => applyDeepmergeBackport(root), /Unknown or partially patched/);
    assert.deepEqual(readFileSync(join(packageRoot, 'dist/cjs.js')), cjs);
  }));
test('a partially patched install fails closed instead of silently completing', () =>
  fixture(({ root, packageRoot }) => {
    writeFileSync(
      join(packageRoot, 'dist/cjs.js'),
      patchDeepmerge(upstreamSnapshot('dist/cjs.js')),
    );
    assert.throws(() => applyDeepmergeBackport(root), /Unknown or partially patched/);
  }));
test('tampering after installation invalidates the release result', () =>
  fixture(({ root, packageRoot, audit, lock }) => {
    applyDeepmergeBackport(root);
    writeFileSync(join(packageRoot, 'dist/cjs.js'), 'changed patched bytes');
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock), /Backport missing or changed/);
  }));
test('an edited consumer is not accepted by the compatibility proof', () =>
  fixture(({ root, consumerPath, audit, lock }) => {
    applyDeepmergeBackport(root);
    writeFileSync(consumerPath, 'changed consumer');
    assert.throws(
      () => verifyNativeReleaseAudit(root, audit, lock),
      /Native config consumer changed/,
    );
  }));
test('unknown package metadata or version cannot inherit the backport', () =>
  fixture(({ root, packageRoot }) => {
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'another-package', version: '4.3.1' }),
    );
    assert.throws(() => applyDeepmergeBackport(root), /package identity changed/);
  }));
test('another locked package version or registry integrity is rejected', () =>
  fixture(({ root, audit, lock }) => {
    applyDeepmergeBackport(root);
    lock.packages['node_modules/@react-native-community/cli'].version = '20.2.1';
    assert.throws(
      () => verifyNativeReleaseAudit(root, audit, lock),
      /dependency provenance changed/,
    );
  }));
test('new findings cannot be added to the source-verified result', () =>
  fixture(({ root, audit, lock }) => {
    applyDeepmergeBackport(root);
    audit.vulnerabilities.extra = { ...audit.vulnerabilities.deepmerge, name: 'extra' };
    audit.metadata.vulnerabilities.low++;
    audit.metadata.vulnerabilities.total++;
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock), /Unexpected findings/);
  }));
test('changed severity is rejected even if totals are internally consistent', () =>
  fixture(({ root, audit, lock }) => {
    applyDeepmergeBackport(root);
    audit.vulnerabilities.deepmerge.severity = 'moderate';
    audit.metadata.vulnerabilities.low--;
    audit.metadata.vulnerabilities.moderate++;
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock), /Unexpected findings/);
  }));
test('another advisory or dependency path cannot inherit this approval', () =>
  fixture(({ root, audit, lock }) => {
    applyDeepmergeBackport(root);
    audit.vulnerabilities.deepmerge.via[0].url = 'https://github.com/advisories/another';
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock), /advisory\/path drift/);
  }));
test('an audit service error or incomplete report is never accepted', () =>
  fixture(({ root, audit, lock }) => {
    applyDeepmergeBackport(root);
    audit.error = { message: 'unavailable' };
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock), /Incomplete/);
    assert.throws(() => verifyDeepmergeBackport(root, audit, lock), /Incomplete/);
  }));
test('a file link remains outside complete registry audit coverage', () =>
  fixture(({ root, audit, lock }) => {
    applyDeepmergeBackport(root);
    lock.packages['node_modules/deepmerge'].link = true;
    assert.throws(
      () => verifyNativeReleaseAudit(root, audit, lock),
      /outside registry audit coverage/,
    );
  }));
test('symlinked source files cannot pass source verification', () =>
  fixture(({ root, packageRoot, audit, lock }) => {
    applyDeepmergeBackport(root);
    const path = join(packageRoot, 'index.js');
    const copy = join(root, 'outside.js');
    writeFileSync(copy, readFileSync(path));
    rmSync(path);
    symlinkSync(copy, path);
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock), /regular package file/);
  }));
