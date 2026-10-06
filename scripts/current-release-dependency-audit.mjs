import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const versions = {
  'eslint-config-next': '16.3.8',
  '@next/eslint-plugin-next': '16.3.8',
  'fast-glob': '3.3.1',
  micromatch: '4.0.8',
  braces: '3.0.3',
};
const ranges = {
  'eslint-config-next': '>=14.3.0-canary.0',
  '@next/eslint-plugin-next': '>=14.3.0-canary.0',
  'fast-glob': '*',
  micromatch: '>=0.2.0',
  braces: '*',
};
const via = {
  'eslint-config-next': ['@next/eslint-plugin-next'],
  '@next/eslint-plugin-next': ['fast-glob'],
  'fast-glob': ['micromatch'],
  micromatch: ['braces'],
};

export function verifyAudit(audit, lock, production) {
  if (audit.error || !audit.metadata?.vulnerabilities || !audit.vulnerabilities) {
    throw new Error('Missing or failed full audit.');
  }
  if (production.error || production.metadata?.vulnerabilities?.total !== 0) {
    throw new Error('Production audit must have zero findings.');
  }
  const keys = Object.keys(audit.vulnerabilities).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(versions).sort())) {
    throw new Error('Unexpected or missing vulnerability paths; approval does not apply.');
  }
  for (const [name, version] of Object.entries(versions)) {
    const path = `node_modules/${name}`;
    if (lock.packages?.[path]?.version !== version || lock.packages[path].dev !== true) {
      throw new Error(`Package/version/development scope drift: ${name}`);
    }
    const finding = audit.vulnerabilities[name];
    if (
      finding.name !== name ||
      finding.severity !== 'high' ||
      finding.range !== ranges[name] ||
      JSON.stringify(finding.nodes) !== JSON.stringify([path])
    ) {
      throw new Error(`Finding scope drift: ${name}`);
    }
    if (name === 'braces') {
      if (
        finding.via.length !== 1 ||
        finding.via[0].source !== 1240992 ||
        finding.via[0].url !== 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' ||
        finding.via[0].range !== '<=3.0.3' ||
        finding.via[0].severity !== 'high'
      ) {
        throw new Error('Root advisory drift.');
      }
    } else if (JSON.stringify(finding.via) !== JSON.stringify(via[name])) {
      throw new Error(`Advisory chain drift: ${name}`);
    }
  }
  if (audit.metadata.vulnerabilities.total !== 5 || audit.metadata.vulnerabilities.high !== 5) {
    throw new Error('Unexpected audit totals.');
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
    const record = JSON.parse(
      readFileSync(resolve(root, 'docs/security/current-release-audit-binding.json')),
    );
    verifyRelease(root, record);
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
      'KNOWN HIGH DEVELOPMENT ADVISORY ACCEPTED FOR THIS EXACT RELEASE ONLY: GHSA-vfj7-8cjw-p6xm; five pinned lint-chain nodes. Production audit: zero findings. This is not an audit-clean result.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
