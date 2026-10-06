import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyNativeAudit } from '../current-release-native-audit.mjs';

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const pins = load('../../docs/security/current-release-native-audit-pins.json');
const lock = load('../../apps/mobile/package-lock.json');
const audit = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 17, critical: 0, total: 17 } },
  vulnerabilities: Object.fromEntries(
    Object.entries(pins.findings).map(([name, { versions, ...finding }]) => [name, finding]),
  ),
};

test('accepts only the reviewed native fixture', () => verifyNativeAudit(audit, lock, pins));

for (const [label, change] of [
  [
    'new advisory',
    (a) =>
      a.vulnerabilities.braces.via.push({
        ...a.vulnerabilities.braces.via[0],
        source: 0,
        url: 'https://github.com/advisories/OTHER',
      }),
  ],
  ['removed finding', (a) => delete a.vulnerabilities.braces],
  ['new vulnerable package', (a) => (a.vulnerabilities.extra = { severity: 'low' })],
  ['new nested path', (a) => a.vulnerabilities.braces.nodes.push('node_modules/extra/braces')],
  ['root identity change', (a) => (a.vulnerabilities['node-forge'].via[0].source = 0)],
  ['root range change', (a) => (a.vulnerabilities.braces.via[0].range = '*')],
  ['inherited chain change', (a) => (a.vulnerabilities.micromatch.via = ['other'])],
  ['finding range change', (a) => (a.vulnerabilities.braces.range = '<=4')],
  ['severity change', (a) => (a.vulnerabilities.braces.severity = 'critical')],
  ['critical advisory count', (a) => (a.metadata.vulnerabilities.critical = 1)],
  ['changed total', (a) => (a.metadata.vulnerabilities.total = 18)],
  ['audit service error', (a) => (a.error = { message: 'unavailable' })],
  ['missing metadata', (a) => delete a.metadata],
  ['unknown audit format', (a) => (a.auditReportVersion = 3)],
]) {
  test(`rejects ${label}`, () => {
    const value = structuredClone(audit);
    change(value);
    assert.throws(() => verifyNativeAudit(value, lock, pins));
  });
}

for (const [name, finding] of Object.entries(pins.findings)) {
  test(`rejects version drift for ${name}`, () => {
    const changed = structuredClone(lock);
    changed.packages[finding.nodes[0]].version = '0.0.0';
    assert.throws(() => verifyNativeAudit(audit, changed, pins));
  });
}

test('rejects a missing locked package', () => {
  const changed = structuredClone(lock);
  delete changed.packages['node_modules/node-forge'];
  assert.throws(() => verifyNativeAudit(audit, changed, pins));
});

test('rejects broadened approval and automatic regeneration', () => {
  const changed = structuredClone(pins);
  changed.advisories.push('OTHER');
  assert.throws(() => verifyNativeAudit(audit, lock, changed));
  changed.advisories = pins.advisories;
  changed.futureRegenerationAuthorized = true;
  assert.throws(() => verifyNativeAudit(audit, lock, changed));
});
