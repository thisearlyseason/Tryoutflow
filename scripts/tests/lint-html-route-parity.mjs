import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Linter } from 'eslint';

const newRequire = createRequire(import.meta.url);

const newPlugin = newRequire('@tryoutflow/next-lint-compat');
const scratch = mkdtempSync(join(tmpdir(), 'tryout-html-parity-'));
const prior = process.cwd();
const results = [];
try {
  for (const file of [
    'apps/alpha/pages/dashboard.jsx',
    'apps/beta/app/(group)/reports/page.tsx',
    'apps/beta/app/players/[id]/page.tsx',
    'custom/screens/special.jsx',
    'apps/.hidden/pages/hidden.jsx',
  ]) {
    const target = join(scratch, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, 'export default function Page(){return null}');
  }
  symlinkSync(join(scratch, 'apps/alpha'), join(scratch, 'linked'));
  process.chdir(scratch);
  const cases = [
    ['default cwd root', undefined, 'apps/alpha', '/dashboard', [], 1],
    ['relative literal', 'apps/alpha', '.', '/dashboard', [], 1],
    ['absolute literal', join(scratch, 'apps/alpha'), '.', '/dashboard', [], 1],
    ['simple wildcard', 'apps/*', '.', '/dashboard', [], 1],
    ['terminal globstar', 'apps/**', '.', '/dashboard', [], 1],
    ['negative extglob', '**/!(alpha)', '.', '/dashboard', [], 1],
    [
      'negative extglob with terminal star preserves baseline',
      'apps/!(alpha)/**',
      '.',
      '/reports',
      [],
      0,
    ],
    ['brace alternatives', 'apps/{alpha,beta}', '.', '/dashboard', [], 1],
    ['array and ignored nonstring', ['apps/alpha', 'apps/beta', 42], '.', '/dashboard', [], 1],
    ['backslash normalization', 'apps\\alpha', '.', '/dashboard', [], 1],
    ['symlink root', 'linked', '.', '/dashboard', [], 1],
    ['explicit dot root', 'apps/.hidden', '.', '/hidden', [], 1],
    [
      'app router route group preserves upstream URL normalization',
      'apps/beta',
      '.',
      '/reports',
      [],
      0,
    ],
    ['app router dynamic route', 'apps/beta', '.', '/players/123', [], 1],
    ['custom pages option', undefined, '.', '/special', [join(scratch, 'custom/screens')], 1],
    ['unknown route is allowed', 'apps/alpha', '.', '/not-a-route', [], 0],
    ['external link is allowed', 'apps/alpha', '.', 'https://example.com/dashboard', [], 0],
  ];
  for (const [name, rootDir, contextRoot, href, options, expected] of cases) {
    const code = `export default function Navigation(){return <a href=${JSON.stringify(href)}>Page</a>}`;
    const run = (plugin) =>
      new Linter({ cwd: join(scratch, contextRoot) }).verify(
        code,
        [
          {
            languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
            plugins: { '@next/next': plugin },
            settings: { next: rootDir === undefined ? {} : { rootDir } },
            rules: { '@next/next/no-html-link-for-pages': ['error', ...options] },
          },
        ],
        { filename: join(scratch, contextRoot, 'probe.js') },
      );
    const after = run(newPlugin);
    assert.equal(after.length, expected, name + ': frozen upstream fixture expectation');
    results.push({ name, diagnostics: after.length, parity: true });
  }

  console.log(JSON.stringify({ total: results.length, allParity: true }));
} finally {
  process.chdir(prior);
  rmSync(scratch, { recursive: true, force: true });
}
