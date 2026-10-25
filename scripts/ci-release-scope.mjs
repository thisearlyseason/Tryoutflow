import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const both = (reason) => ({ web: true, native: true, reason });

// An allowlist, not a list of exclusions. New/unknown paths require both scopes.
// Root dependency/tooling files are intentionally shared, even with separate locks.
export function pathScope(path) {
  if (
    typeof path !== 'string' ||
    /[\x00-\x1f\x7f\\]/u.test(path) ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    return 'shared';
  if (
    path.startsWith('docs/security/') ||
    path.startsWith('.github/') ||
    path.startsWith('supabase/') ||
    path.startsWith('src/infrastructure/') ||
    /(?:\/contracts(?:\/|\.)|\.d\.ts$|\/route\.[jt]s$)/u.test(path) ||
    path === 'vercel.json' ||
    path.startsWith('src/app/api/') ||
    path.startsWith('src/app/native/') ||
    /^(?:src|tests)\/.*(?:native|bridge)/u.test(path)
  )
    return 'shared';
  if (path.startsWith('apps/mobile/')) return 'native';
  if (
    /^(?:src\/app|src\/components|src\/styles|public|tests\/unit)\//u.test(path) ||
    /^src\/modules\/[^/]+\/ui\//u.test(path) ||
    /^(?:next\.config\.[cm]?[jt]s|next-env\.d\.ts|postcss\.config\.[cm]?[jt]s)$/u.test(path)
  )
    return 'web';
  if ((path.startsWith('docs/') && path.endsWith('.md')) || path === 'README.md') return 'docs';
  return 'shared';
}

// --name-status -z supplies both sides of a rename/copy. Never classify just the new path.
export function parseChanges(raw) {
  if (typeof raw !== 'string' || (raw && !raw.endsWith('\0'))) throw new Error('Truncated diff');
  const tokens = raw.split('\0');
  tokens.pop();
  const changes = [];
  while (tokens.length) {
    const status = tokens.shift();
    if (!/^(?:[ADMT]|[RC](?:100|[0-9]{1,2}))$/u.test(status))
      throw new Error('Unknown diff status');
    const count = /^[RC]/u.test(status) ? 2 : 1;
    const paths = tokens.splice(0, count);
    if (paths.length !== count || paths.some((path) => !path)) throw new Error('Missing diff path');
    changes.push({ status, paths });
  }
  return changes;
}

export function classifyChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return both('empty-or-unknown-diff');
  let web = false;
  let native = false;
  for (const change of changes) {
    if (
      !change ||
      change.status === 'T' ||
      !Array.isArray(change.paths) ||
      change.paths.length === 0
    )
      return both('invalid-change');
    for (const path of change.paths) {
      const scope = pathScope(path);
      if (scope === 'shared') return both('shared-or-unknown-path');
      web ||= scope === 'web';
      native ||= scope === 'native';
    }
  }
  return {
    web,
    native,
    reason:
      web && native ? 'web-and-native' : web ? 'web-only' : native ? 'native-only' : 'docs-only',
  };
}

export function determineScope({ eventName, event, head }, git) {
  // Manual/tag/new-branch/missing-history runs cannot opt out of either audit.
  if (!shaPattern.test(head ?? '')) return both('invalid-head');
  if (!['push', 'pull_request'].includes(eventName)) return both('manual-or-unsupported-event');
  if (
    eventName === 'push' &&
    (typeof event?.ref !== 'string' || !event.ref.startsWith('refs/heads/'))
  )
    return both('tag-or-missing-branch-ref');
  const base = eventName === 'pull_request' ? event?.pull_request?.base?.sha : event?.before;
  if (!shaPattern.test(base ?? '') || /^0+$/u.test(base)) return both('missing-diff-base');
  try {
    if (git(['rev-parse', 'HEAD']).trim() !== head) return both('checkout-identity-mismatch');
    git(['cat-file', '-e', `${base}^{commit}`]);
    git(['merge-base', '--is-ancestor', base, head]);
    return classifyChanges(
      parseChanges(
        git([
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--name-status',
          '-z',
          '--find-renames',
          base,
          head,
          '--',
        ]),
      ),
    );
  } catch {
    return both('unavailable-or-invalid-diff');
  }
}

export function verifyScopeResults(needs, head) {
  if (!shaPattern.test(head ?? '') || needs?.scope?.result !== 'success')
    throw new Error('Scope classification did not succeed');
  const outputs = needs.scope.outputs;
  if (
    !outputs ||
    outputs.sha !== head ||
    !['true', 'false'].includes(outputs.web) ||
    !['true', 'false'].includes(outputs.native)
  )
    throw new Error('Missing or mismatched scope receipt');
  if (outputs.web === 'false' && outputs.native === 'false' && outputs.reason !== 'docs-only')
    throw new Error('Unproven empty scope');
  for (const scope of ['web', 'native']) {
    const required = outputs[scope] === 'true';
    const result = needs[scope]?.result;
    if (required ? result !== 'success' : !['success', 'skipped'].includes(result))
      throw new Error(`${scope} gate did not meet its required outcome`);
  }
  return {
    sha: head,
    web: outputs.web === 'true',
    native: outputs.native === 'true',
    reason: outputs.reason,
    publicationAuthorized: false,
  };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !['classify', 'verify'].includes(process.argv[2]))
      throw new Error('Usage: node scripts/ci-release-scope.mjs classify|verify');
    let receipt;
    if (process.argv[2] === 'classify') {
      let event = {};
      try {
        event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      } catch {
        /* fail closed below */
      }
      const git = (args) =>
        execFileSync('git', args, {
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      receipt = {
        ...determineScope(
          { eventName: process.env.GITHUB_EVENT_NAME, event, head: process.env.GITHUB_SHA },
          git,
        ),
        sha: process.env.GITHUB_SHA,
      };
      if (!shaPattern.test(receipt.sha ?? '')) throw new Error('Missing exact CI source identity');
      if (!process.env.GITHUB_OUTPUT) throw new Error('Missing CI output file');
      for (const field of ['web', 'native', 'reason', 'sha'])
        appendFileSync(process.env.GITHUB_OUTPUT, `${field}=${receipt[field]}\n`);
    } else {
      receipt = verifyScopeResults(
        JSON.parse(process.env.CI_NEEDS_JSON ?? 'null'),
        process.env.GITHUB_SHA,
      );
    }
    mkdirSync('.next/release-audit', { recursive: true });
    writeFileSync(
      `.next/release-audit/scope-${process.argv[2]}.json`,
      JSON.stringify(receipt, null, 2) + '\n',
    );
    console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
