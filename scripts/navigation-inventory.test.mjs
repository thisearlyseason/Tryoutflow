import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { appRoute, auditNavigation, hasRoute } from './navigation-inventory.mjs';

test('route matching preserves segment boundaries and supports App Router groups/catchalls', () => {
  assert.equal(
    appRoute('src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/coverage/page.tsx'),
    '/app/[organizationSlug]/tryouts/[tryoutId]/coverage',
  );
  assert.equal(appRoute('src/app/layout.tsx'), null);
  assert.equal(
    hasRoute('/app/a/tryouts/b/coverage?filter=missing', ['/app/[org]/tryouts/[event]/coverage']),
    true,
  );
  assert.equal(
    hasRoute('/app/a/tryouts/b/coverage/extra', ['/app/[org]/tryouts/[event]/coverage']),
    false,
  );
  assert.equal(hasRoute('/guide', ['/guide/[[...parts]]']), true);
  assert.equal(hasRoute('/guide/a/b', ['/guide/[[...parts]]']), true);
  assert.equal(hasRoute('/guide', ['/guide/[...parts]']), false);
});

test('inventory audit detects an omitted ignored route despite its presence on disk', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tryout-navigation-inventory-'));
  const page = 'src/app/(app)/app/[org]/tryouts/[event]/coverage/page.tsx';
  const component = 'src/components/navigation.tsx';
  for (const file of [page, component])
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, page), 'export default function Page(){return null;}');
  writeFileSync(
    path.join(root, component),
    'export const Link = () => <a href="/app/local/tryouts/example/coverage?filter=missing">Coverage</a>;',
  );
  assert.equal(auditNavigation(root, [component]).missing.length, 1);
  assert.equal(auditNavigation(root, [page, component]).missing.length, 0);
});

test('computed destinations remain unresolved rather than receiving false PASS', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tryout-navigation-computed-'));
  const file = 'src/navigation.tsx';
  mkdirSync(path.join(root, 'src'));
  writeFileSync(
    path.join(root, file),
    'export const Link = ({target}) => <a href={target}>Open</a>;',
  );
  const result = auditNavigation(root, [file]);
  assert.equal(result.checked.length, 0);
  assert.equal(result.unresolved.length, 1);
});

test('an ambiguous shared base cannot pass by matching a different route context', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tryout-navigation-base-'));
  const file = 'src/navigation.tsx';
  const route = 'src/app/app/[org]/tryouts/[event]/rankings/page.tsx';
  mkdirSync(path.dirname(path.join(root, route)), { recursive: true });
  writeFileSync(path.join(root, route), 'export default function Page(){return null;}');
  writeFileSync(
    path.join(root, file),
    'export const Link = ({base}) => <a href={`${base}/rankings`}>Rankings</a>;',
  );
  const unresolved = auditNavigation(root, [file, route]);
  assert.equal(unresolved.checked.length, 0);
  assert.equal(unresolved.unresolved.length, 1);
  writeFileSync(
    path.join(root, file),
    'const base="/app/local"; export const Link = () => <a href={`${base}/rankings`}>Rankings</a>;',
  );
  const wrongContext = auditNavigation(root, [file, route]);
  assert.equal(wrongContext.missing.length, 1);
});
