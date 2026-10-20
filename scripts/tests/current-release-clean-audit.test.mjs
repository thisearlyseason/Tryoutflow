import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyAudit } from '../current-release-dependency-audit.mjs';
const clean = () => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { critical: 0, high: 0, info: 0, low: 0, moderate: 0, total: 0 } },
});
const lock = { lockfileVersion: 3, packages: { '': {} } };
test('accept complete zero-finding full and production reports', () =>
  verifyAudit(clean(), lock, clean()));
for (const [name, change] of [
  [
    'service error',
    (x) => {
      x.error = { message: 'unavailable' };
    },
  ],
  [
    'unknown report version',
    (x) => {
      x.auditReportVersion = 3;
    },
  ],
  [
    'missing metadata',
    (x) => {
      delete x.metadata;
    },
  ],
  [
    'missing counts',
    (x) => {
      delete x.metadata.vulnerabilities.low;
    },
  ],
  [
    'unknown severity count',
    (x) => {
      x.metadata.vulnerabilities.other = 0;
    },
  ],
  [
    'negative count',
    (x) => {
      x.metadata.vulnerabilities.high = -1;
    },
  ],
  [
    'any advisory even with inconsistent total',
    (x) => {
      x.vulnerabilities.braces = { severity: 'high' };
    },
  ],
  [
    'known five findings are not waived',
    (x) => {
      x.metadata.vulnerabilities.total = 5;
      x.metadata.vulnerabilities.high = 5;
    },
  ],
  [
    'new critical finding',
    (x) => {
      x.metadata.vulnerabilities.total = 1;
      x.metadata.vulnerabilities.critical = 1;
    },
  ],
  [
    'array instead of findings object',
    (x) => {
      x.vulnerabilities = [];
    },
  ],
])
  for (const scope of ['full', 'production'])
    test(`reject ${scope}: ${name}`, () => {
      const full = clean();
      const production = clean();
      change(scope === 'full' ? full : production);
      assert.throws(() => verifyAudit(full, lock, production));
    });
test('reject missing frozen lockfile', () =>
  assert.throws(() => verifyAudit(clean(), {}, clean())));
