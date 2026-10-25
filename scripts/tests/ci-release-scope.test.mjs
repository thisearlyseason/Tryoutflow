import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  classifyChanges,
  determineScope,
  parseChanges,
  pathScope,
  verifyScopeResults,
} from '../ci-release-scope.mjs';
const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const change = (path, status = 'M') => ({ status, paths: [path] });

for (const [path, scope] of [
  ['src/modules/subscriptions/ui/billing-dashboard.tsx', 'web'],
  ['tests/unit/auth.test.ts', 'web'],
  ['supabase/migrations/166.sql', 'shared'],
  ['public/logo.svg', 'web'],
  ['next.config.ts', 'web'],
  ['src/infrastructure/supabase/client.ts', 'shared'],
  ['src/modules/evaluations/domain/contracts.ts', 'shared'],
  ['src/types/native.d.ts', 'shared'],
  ['src/lib/new-unknown.ts', 'shared'],
  ['vercel.json', 'shared'],
  ['apps/mobile/package-lock.json', 'native'],
  ['apps/mobile/src/App.tsx', 'native'],
  ['README.md', 'docs'],
  ['docs/getting-started.md', 'docs'],
  ['docs/security/pins.md', 'shared'],
  ['docs/unknown.json', 'shared'],
  ['src/app/api/billing/route.ts', 'shared'],
  ['src/modules/identity/ui/native-workspace-bridge.tsx', 'shared'],
  ['package-lock.json', 'shared'],
  ['package.json', 'shared'],
  ['.github/workflows/ci.yml', 'shared'],
  ['scripts/release.mjs', 'shared'],
  ['packages/shared/auth.ts', 'shared'],
  ['unknown.ts', 'shared'],
  ['../src/app/a.tsx', 'shared'],
  ['/src/app/a.tsx', 'shared'],
  ['src/../apps/mobile/a.ts', 'shared'],
  ['src/a\nb.ts', 'shared'],
])
  test(`path ${JSON.stringify(path)} selects ${scope}`, () => assert.equal(pathScope(path), scope));

test('docs-only is explicit and cannot release runtime changes', () => {
  assert.deepEqual(classifyChanges([change('README.md'), change('docs/start.md')]), {
    web: false,
    native: false,
    reason: 'docs-only',
  });
  assert.equal(classifyChanges([change('docs/start.md'), change('src/app/page.tsx')]).web, true);
});
test('web-only and native-only stay separate; mixed and shared run both', () => {
  assert.deepEqual(classifyChanges([change('src/app/page.tsx')]), {
    web: true,
    native: false,
    reason: 'web-only',
  });
  assert.deepEqual(classifyChanges([change('apps/mobile/src/App.tsx')]), {
    web: false,
    native: true,
    reason: 'native-only',
  });
  for (const paths of [['src/a.ts', 'apps/mobile/a.ts'], ['package-lock.json'], ['unknown']]) {
    const scope = classifyChanges(paths.map((path) => change(path)));
    assert.equal(scope.web, true);
    assert.equal(scope.native, true);
  }
});
test('type changes cannot hide a symlink under a docs or web allowlist', () => {
  assert.deepEqual(classifyChanges(parseChanges('T\0docs/start.md\0')), {
    web: true,
    native: true,
    reason: 'invalid-change',
  });
});

test('renames and copies include both sides, including moving shared policy into docs', () => {
  for (const status of ['R100', 'C75']) {
    assert.deepEqual(parseChanges(`${status}\0src/a.ts\0apps/mobile/a.ts\0`), [
      { status, paths: ['src/a.ts', 'apps/mobile/a.ts'] },
    ]);
    const result = classifyChanges(parseChanges(`${status}\0package-lock.json\0docs/old.md\0`));
    assert.equal(result.web && result.native, true);
  }
});
test('deletions retain their original scope and unusual/truncated statuses fail closed', () => {
  assert.equal(classifyChanges(parseChanges('D\0apps/mobile/src/App.tsx\0')).native, true);
  assert.equal(classifyChanges(parseChanges('D\0.github/workflows/ci.yml\0')).web, true);
  for (const raw of ['M\0src/a.ts', 'R100\0src/a.ts\0', 'U\0src/a.ts\0', 'X\0a\0', 'R101\0a\0b\0'])
    assert.throws(() => parseChanges(raw));
});
const gitStub =
  (raw = 'M\0src/app/page.tsx\0') =>
  (args) =>
    args[0] === 'rev-parse' ? head : args[0] === 'diff' ? raw : '';
test('push and PR compare the exact checked-out merge source', () => {
  for (const [eventName, event] of [
    ['push', { before: base, ref: 'refs/heads/main' }],
    ['pull_request', { pull_request: { base: { sha: base } } }],
  ]) {
    assert.equal(determineScope({ eventName, event, head }, gitStub()).reason, 'web-only');
  }
});
test('manual runs, missing/zero base, unavailable history, force-push and missing HEAD run both', () => {
  for (const input of [
    { eventName: 'workflow_dispatch', event: {}, head },
    { eventName: 'push', event: {}, head },
    { eventName: 'push', event: { before: '0'.repeat(40) }, head },
    { eventName: 'pull_request', event: {}, head },
    { eventName: 'push', event: { before: base, ref: 'refs/heads/main' }, head: undefined },
  ])
    assert.equal(determineScope(input, gitStub()).native, true);
  assert.equal(
    determineScope(
      { eventName: 'push', event: { before: base, ref: 'refs/heads/main' }, head },
      () => {
        throw new Error('missing history');
      },
    ).native,
    true,
  );
  assert.equal(
    determineScope(
      { eventName: 'push', event: { before: base, ref: 'refs/heads/main' }, head },
      () => base,
    ).native,
    true,
  );
});
test('existing tag updates and missing push refs cannot skip scopes', () => {
  for (const ref of ['refs/tags/v1', undefined, 'refs/unknown/test']) {
    assert.equal(
      determineScope({ eventName: 'push', event: { before: base, ref }, head }, gitStub()).reason,
      'tag-or-missing-branch-ref',
    );
  }
});

test('malformed and empty diff cannot produce a docs-only skip', () => {
  for (const raw of ['', 'M\0truncated', 'X\0unknown\0'])
    assert.equal(
      determineScope(
        { eventName: 'push', event: { before: base, ref: 'refs/heads/main' }, head },
        gitStub(raw),
      ).native,
      true,
    );
});
function needs(web, native, reason = 'web-only') {
  return {
    scope: {
      result: 'success',
      outputs: { sha: head, web: String(web), native: String(native), reason },
    },
    web: { result: web ? 'success' : 'skipped' },
    native: { result: native ? 'success' : 'skipped' },
  };
}
for (const [web, native, reason] of [
  [true, false, 'web-only'],
  [false, true, 'native-only'],
  [true, true, 'shared-or-unknown-path'],
  [false, false, 'docs-only'],
]) {
  test(`required gate accepts only proven ${reason} outcomes`, () =>
    assert.equal(
      verifyScopeResults(needs(web, native, reason), head).publicationAuthorized,
      false,
    ));
}
for (const scope of ['web', 'native']) {
  for (const result of ['failure', 'cancelled', 'skipped', undefined, 'neutral', 'timed_out'])
    test(`required ${scope} rejects ${result}`, () => {
      const state = needs(true, true);
      state[scope].result = result;
      assert.throws(() => verifyScopeResults(state, head));
    });
}
test('classifier failure, skipped classification, absent output and mismatched SHA fail final gate', () => {
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    const state = needs(true, false);
    state.scope.result = result;
    assert.throws(() => verifyScopeResults(state, head));
  }
  const state = needs(true, false);
  delete state.scope.outputs.native;
  assert.throws(() => verifyScopeResults(state, head));
  assert.throws(() => verifyScopeResults(needs(true, false), base));
  assert.throws(() => verifyScopeResults(needs(false, false, 'unknown'), head));
  assert.throws(() => verifyScopeResults(null, head));
});
test('unexpected failed optional job is never hidden', () => {
  const state = needs(true, false);
  state.native.result = 'failure';
  assert.throws(() => verifyScopeResults(state, head));
});

test('actual git rename and deletion cross boundaries with a valid base', () => {
  const root = mkdtempSync(join(tmpdir(), 'tryoutflow-scope-git-'));
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 'scope-test@example.invalid']);
    git(['config', 'user.name', 'Scope Test']);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), 'same contents\n');
    writeFileSync(join(root, 'package-lock.json'), '{}\n');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
    const before = git(['rev-parse', 'HEAD']).trim();
    mkdirSync(join(root, 'apps/mobile'), { recursive: true });
    git(['mv', 'src/a.ts', 'apps/mobile/a.ts']);
    git(['rm', 'package-lock.json']);
    git(['commit', '-qm', 'move and delete']);
    const sha = git(['rev-parse', 'HEAD']).trim();
    assert.deepEqual(
      determineScope(
        { eventName: 'push', event: { before, ref: 'refs/heads/main' }, head: sha },
        git,
      ),
      {
        web: true,
        native: true,
        reason: 'shared-or-unknown-path',
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workflow retains stable required verify status and always inspects exact scoped results', () => {
  const workflow = load(
    readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch']);
  assert.equal(workflow.jobs.verify.if, '${{ always() }}');
  assert.deepEqual(workflow.jobs.verify.needs, ['scope', 'web', 'native']);
  assert.equal(
    workflow.jobs.verify.steps.find((step) => step.run?.includes('ci-release-scope.mjs verify')).env
      .CI_NEEDS_JSON,
    '${{ toJSON(needs) }}',
  );
  assert.equal(workflow.jobs.scope.steps[0].with['fetch-depth'], 0);
  for (const scope of ['web', 'native']) {
    const job = workflow.jobs[scope];
    assert.equal(job.needs, 'scope');
    assert.equal(job.if, `needs.scope.outputs.${scope} == 'true'`);
    assert(job.steps.some((step) => step.run?.includes('current-release-dependency-audit.mjs')));
    assert(job.steps.every((step) => !step['continue-on-error']));
    assert(!job['continue-on-error']);
  }
  const web = workflow.jobs.web.steps.map((step) => step.run ?? '').join('\n');
  const native = workflow.jobs.native.steps.map((step) => step.run ?? '').join('\n');
  assert(web.includes('verify-production-readiness.sh'));
  assert(web.includes('tests/unit/identity/native-workspace-bridge.test.tsx'));
  assert(native.includes('current-release-native-audit.mjs'));
  assert(native.includes('current-release-native-audit.test.mjs'));
  assert(native.includes('current-release-native-clean-audit.test.mjs'));
  assert(native.includes('typecheck'));
  assert(native.includes('vitest'));
  assert(native.includes('expo export --platform ios'));
  assert(native.includes('expo export --platform android'));
  assert(!/deploy|submit|eas build|git push/u.test(native));
  assert.equal(
    readFileSync(new URL('../../apps/mobile/vitest.config.mts', import.meta.url), 'utf8').includes(
      '**/*.test.{ts,tsx}',
    ),
    true,
  );
});
