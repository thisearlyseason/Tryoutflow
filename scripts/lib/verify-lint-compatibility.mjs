import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function verifyLintCompatibility(root) {
  const directory = resolve(root, 'tools/lint/next-lint-compat');
  const record = JSON.parse(readFileSync(join(directory, 'INTEGRITY.json'), 'utf8'));
  if (record.schemaVersion !== 1 || record.remediatedAdvisory !== 'GHSA-vfj7-8cjw-p6xm') {
    throw new Error('Missing reviewed lint compatibility integrity record.');
  }
  const actual = {};
  const visit = (relative = '') => {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      if (name === 'node_modules' || (!relative && name === 'INTEGRITY.json')) continue;
      const path = join(relative, name);
      const entry = lstatSync(join(directory, path));
      if (entry.isSymbolicLink())
        throw new Error(`Unexpected lint compatibility source symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile())
        actual[path] = createHash('sha256')
          .update(readFileSync(join(directory, path)))
          .digest('hex');
      else throw new Error(`Unexpected lint compatibility source entry: ${path}`);
    }
  };
  visit();
  const normalize = (value) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en'));
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(record.files))) {
    throw new Error('Reviewed lint compatibility source changed; integrity verification failed.');
  }
}
