import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyLintCompatibility } from './lib/verify-lint-compatibility.mjs';

export function verifyAudit(audit, lock, production) {
  if (lock?.lockfileVersion !== 3 || !lock.packages?.[''])
    throw new Error('Missing frozen lockfile.');
  for (const [label, report] of [
    ['Full', audit],
    ['Production', production],
  ]) {
    const counts = report?.metadata?.vulnerabilities;
    const expected = ['critical', 'high', 'info', 'low', 'moderate', 'total'];
    if (
      report?.error ||
      report?.auditReportVersion !== 2 ||
      !counts ||
      JSON.stringify(Object.keys(counts).sort()) !== JSON.stringify(expected) ||
      expected.some((key) => counts[key] !== 0) ||
      !report.vulnerabilities ||
      typeof report.vulnerabilities !== 'object' ||
      Array.isArray(report.vulnerabilities) ||
      Object.keys(report.vulnerabilities).length !== 0
    ) {
      throw new Error(`${label} audit must have zero findings in a complete successful report.`);
    }
  }
}

/** Bind all tracked source (including tracked ignored files) and all non-ignored new source.
 * Supabase/browser runtime output is ignored by Git and is not part of the release source.
 */
export function releaseSourceFiles(root) {
  const binding = 'docs/security/current-release-audit-binding.json';
  const paths = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter((name) => name && name !== binding);
  return [...new Set(paths)]
    .map((name) => {
      const path = resolve(root, name);
      if (!lstatSync(path).isFile()) throw new Error(`Unexpected source symlink: ${name}`);
      return { path: name, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function verifyRelease(root, record) {
  const files = releaseSourceFiles(root);
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  if (
    record.releaseManifestSHA256 !== hash ||
    JSON.stringify(record.files) !== JSON.stringify(files)
  ) {
    throw new Error(
      'Current-release source binding changed; exception is inactive for this source.',
    );
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('No override flags are supported.');
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    verifyLintCompatibility(root);
    const run = (args) => {
      const result = spawnSync('corepack', ['npm@11.12.1', 'audit', '--json', ...args], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      if (result.error || ![0, 1].includes(result.status))
        throw new Error('Audit execution failed.');
      return JSON.parse(result.stdout);
    };
    const full = run([]);
    const production = run(['--omit=dev']);
    mkdirSync(resolve(root, '.next/release-audit'), { recursive: true });
    writeFileSync(resolve(root, '.next/release-audit/full.json'), JSON.stringify(full, null, 2));
    writeFileSync(
      resolve(root, '.next/release-audit/production.json'),
      JSON.stringify(production, null, 2),
    );
    verifyAudit(full, JSON.parse(readFileSync(resolve(root, 'package-lock.json'))), production);
    console.log(
      'Full and production registry audits: zero findings. Reviewed private lint compatibility source integrity verified; no advisory exception accepted.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
