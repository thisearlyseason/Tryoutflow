import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { releaseSourceFiles } from '../current-release-dependency-audit.mjs';
import {
  verifyNativeAuditReport,
  verifyNativeReleaseAudit,
} from '../current-release-native-audit.mjs';
const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const lock = load('../../apps/mobile/package-lock.json');
const pins = load('../../docs/security/current-release-native-audit-pins.json');
const clean = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  vulnerabilities: {},
};
const oldAudit = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 17, critical: 0, total: 17 } },
  vulnerabilities: Object.fromEntries(
    Object.entries(pins.findings).map(([name, { versions, ...finding }]) => [name, finding]),
  ),
};
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'tryoutflow-native-audit-mode-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, 'source.js'), 'reviewed fixture\n');
    execFileSync('git', ['add', 'source.js'], { cwd: root });
    const files = releaseSourceFiles(root);
    const record = {
      files,
      releaseManifestSHA256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    };
    run(root, record);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test('a complete zero-finding report passes without consulting an exception or its source binding', () => {
  assert.equal(
    verifyNativeReleaseAudit('/not-a-repository', clean, lock, undefined, undefined),
    'clean',
  );
});
test('changed source can pass only a genuinely clean report, not inherit the old exception', () =>
  fixture((root, record) => {
    assert.equal(
      verifyNativeReleaseAudit(root, oldAudit, lock, pins, record),
      'exact-release-exception',
    );
    writeFileSync(join(root, 'source.js'), 'changed source\n');
    assert.throws(
      () => verifyNativeReleaseAudit(root, oldAudit, lock, pins, record),
      /exception is inactive/,
    );
    assert.equal(verifyNativeReleaseAudit(root, clean, lock, pins, record), 'clean');
  }));
test('a changed finding still fails on an exactly bound source', () =>
  fixture((root, record) => {
    const audit = structuredClone(oldAudit);
    audit.vulnerabilities['node-forge'].via[0].source = 0;
    assert.throws(() => verifyNativeReleaseAudit(root, audit, lock, pins, record), /drift/);
  }));
for (const [label, mutate] of [
  [
    'error',
    (a) => {
      a.error = { message: 'registry unavailable' };
    },
  ],
  [
    'missing version',
    (a) => {
      delete a.auditReportVersion;
    },
  ],
  [
    'missing metadata',
    (a) => {
      delete a.metadata;
    },
  ],
  [
    'missing counts',
    (a) => {
      delete a.metadata.vulnerabilities.high;
    },
  ],
  [
    'extra severity',
    (a) => {
      a.metadata.vulnerabilities.unknown = 0;
    },
  ],
  [
    'string counts',
    (a) => {
      a.metadata.vulnerabilities.high = '0';
    },
  ],
  [
    'negative counts',
    (a) => {
      a.metadata.vulnerabilities.high = -1;
    },
  ],
  [
    'fractional counts',
    (a) => {
      a.metadata.vulnerabilities.high = 0.5;
    },
  ],
  [
    'hidden finding',
    (a) => {
      a.vulnerabilities.forge = { severity: 'high' };
    },
  ],
  [
    'absent findings',
    (a) => {
      delete a.vulnerabilities;
    },
  ],
  [
    'array findings',
    (a) => {
      a.vulnerabilities = [];
    },
  ],
  [
    'wrong total',
    (a) => {
      a.metadata.vulnerabilities.total = 1;
    },
  ],
  [
    'count without finding',
    (a) => {
      a.metadata.vulnerabilities.high = a.metadata.vulnerabilities.total = 1;
    },
  ],
  [
    'severity mismatch',
    (a) => {
      a.metadata.vulnerabilities.high = a.metadata.vulnerabilities.total = 1;
      a.vulnerabilities.forge = { severity: 'low' };
    },
  ],
])
  test(`malformed clean report cannot pass or fall back: ${label}`, () => {
    const audit = structuredClone(clean);
    mutate(audit);
    assert.throws(() => verifyNativeReleaseAudit('/not-a-repository', audit, lock, pins, {}));
  });
for (const changed of [
  undefined,
  {},
  { lockfileVersion: 2, packages: { '': {} } },
  { lockfileVersion: 3, packages: {} },
])
  test('clean audit still requires a frozen native lockfile', () =>
    assert.throws(() => verifyNativeAuditReport(clean, changed), /lockfile/));
test('actual nonzero advisory report is not labeled clean', () =>
  assert.equal(verifyNativeAuditReport(oldAudit, lock), false));

// Execute an exact copy of the CLI in a disposable repository-shaped directory.
// Only its subprocess boundary is stubbed; this never touches the real audit output.
for (const [exitCode, expected] of [
  [0, 0],
  [1, 1],
  [2, 1],
]) {
  test(`CLI clean JSON with audit command exit ${exitCode} yields ${expected}`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'tryoutflow-native-audit-cli-')));
    try {
      for (const dir of ['scripts/lib', 'apps/mobile', 'bin'])
        mkdirSync(join(root, dir), { recursive: true });
      for (const relative of [
        'current-release-native-audit.mjs',
        'current-release-dependency-audit.mjs',
        'lib/verify-lint-compatibility.mjs',
      ]) {
        copyFileSync(new URL(`../${relative}`, import.meta.url), join(root, 'scripts', relative));
      }
      writeFileSync(join(root, 'apps/mobile/package-lock.json'), JSON.stringify(lock));
      const stub = join(root, 'bin/corepack');
      writeFileSync(
        stub,
        '#!/usr/bin/env node\nprocess.stdout.write(process.env.FIXTURE_AUDIT_JSON); process.exit(Number(process.env.FIXTURE_EXIT));\n',
      );
      chmodSync(stub, 0o700);
      const result = spawnSync(
        process.execPath,
        [join(root, 'scripts/current-release-native-audit.mjs')],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${join(root, 'bin')}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
            FIXTURE_AUDIT_JSON: JSON.stringify(clean),
            FIXTURE_EXIT: String(exitCode),
          },
        },
      );
      assert.equal(result.status, expected, result.stderr);
      if (exitCode === 0) assert.match(result.stdout, /zero findings.*No advisory exception/u);
      if (exitCode === 1) assert.match(result.stderr, /command did not succeed/u);
      if (exitCode === 2) assert.match(result.stderr, /execution failed/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const [label, mutate] of [
  [
    'file link',
    (entry) => {
      entry.link = true;
    },
  ],
  [
    'bundled code',
    (entry) => {
      entry.inBundle = true;
    },
  ],
  [
    'missing integrity',
    (entry) => {
      delete entry.integrity;
    },
  ],
  [
    'invalid integrity',
    (entry) => {
      entry.integrity = 'not-an-integrity';
    },
  ],
  [
    'local source',
    (entry) => {
      entry.resolved = 'file:../patched-source';
    },
  ],
  [
    'unrecognized registry',
    (entry) => {
      entry.resolved = 'https://example.invalid/package.tgz';
    },
  ],
  [
    'Git source',
    (entry) => {
      entry.resolved = 'git+https://github.com/example/package.git#main';
    },
  ],
  [
    'missing version',
    (entry) => {
      delete entry.version;
    },
  ],
])
  test(`zero report cannot conceal unaudited native dependency: ${label}`, () => {
    const changed = structuredClone(lock);
    mutate(changed.packages['node_modules/node-forge']);
    assert.throws(
      () => verifyNativeReleaseAudit('/not-a-repository', clean, changed, undefined, undefined),
      /coverage/u,
    );
  });
test('zero report with a linked vulnerable package and missing registry coverage is rejected', () => {
  const linked = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'synthetic-audit-proof' },
      '../local/node-forge': { name: 'node-forge', version: '1.4.0' },
      'node_modules/node-forge': { resolved: '../local/node-forge', link: true },
    },
  };
  assert.throws(
    () => verifyNativeReleaseAudit('/not-a-repository', clean, linked, undefined, undefined),
    /coverage/u,
  );
});
