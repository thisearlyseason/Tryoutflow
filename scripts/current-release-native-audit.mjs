import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyRelease } from './current-release-dependency-audit.mjs';

const allowed = ['GHSA-vfj7-8cjw-p6xm', 'GHSA-86w9-cpqp-85rv'];
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
const project = (finding) => ({
  name: finding.name,
  severity: finding.severity,
  range: finding.range,
  nodes: finding.nodes,
  via: finding.via.map((entry) =>
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

export function verifyNativeAudit(audit, lock, pins) {
  if (
    pins.ownerApprovalUTC !== '2026-10-06T15:10:58Z' ||
    pins.futureRegenerationAuthorized !== false ||
    stable(pins.advisories) !== stable(allowed) ||
    Object.keys(pins.findings).length !== 17
  )
    throw new Error('Native approval scope changed.');
  if (
    audit.error ||
    audit.auditReportVersion !== 2 ||
    stable(audit.metadata?.vulnerabilities) !==
      stable({ info: 0, low: 0, moderate: 0, high: 17, critical: 0, total: 17 }) ||
    stable(Object.keys(audit.vulnerabilities ?? {}).sort()) !==
      stable(Object.keys(pins.findings).sort())
  )
    throw new Error('Unexpected native audit findings or failed audit.');
  const roots = [];
  for (const [name, expected] of Object.entries(pins.findings)) {
    const actual = audit.vulnerabilities[name];
    const { versions, ...finding } = expected;
    if (actual.severity !== 'high' || stable(project(actual)) !== stable(finding))
      throw new Error(`Native advisory/path drift: ${name}`);
    if (stable(Object.keys(versions).sort()) !== stable(actual.nodes.toSorted()))
      throw new Error(`Native pinned path drift: ${name}`);
    for (const path of actual.nodes) {
      if (lock.packages?.[path]?.version !== versions[path])
        throw new Error(`Native package version drift: ${path}`);
    }
    for (const entry of actual.via) {
      if (typeof entry !== 'string') roots.push(entry.url?.split('/').at(-1));
    }
  }
  if (stable(roots.toSorted()) !== stable(allowed.toSorted()))
    throw new Error('Native root advisory drift.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('No override flags are supported.');
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    const json = (path) => JSON.parse(readFileSync(resolve(root, path)));
    verifyRelease(root, json('docs/security/current-release-audit-binding.json'));
    const result = spawnSync(
      'corepack',
      ['npm@11.12.1', 'audit', '--prefix', 'apps/mobile', '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.error || ![0, 1].includes(result.status))
      throw new Error('Native audit execution failed.');
    const audit = JSON.parse(result.stdout);
    mkdirSync(resolve(root, '.next/release-audit'), { recursive: true });
    writeFileSync(resolve(root, '.next/release-audit/native.json'), JSON.stringify(audit, null, 2));
    verifyNativeAudit(
      audit,
      json('apps/mobile/package-lock.json'),
      json('docs/security/current-release-native-audit-pins.json'),
    );
    console.log(
      'KNOWN HIGH NATIVE TOOL ADVISORIES ACCEPTED FOR THIS EXACT RELEASE ONLY: GHSA-vfj7-8cjw-p6xm and GHSA-86w9-cpqp-85rv; 17 pinned paths. Tooling risk remains. This is not an audit-clean or payment/store-readiness result.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
