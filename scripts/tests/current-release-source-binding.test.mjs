import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { releaseSourceFiles, verifyRelease } from '../current-release-dependency-audit.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'tryoutflow-source-binding-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(
      join(root, '.gitignore'),
      'node_modules/\n.next/\nsupabase/.temp/\nplaywright-report/\noutput/playwright/*-results/\n',
    );
    writeFileSync(join(root, 'source.ts'), 'export const source = 1;\n');
    execFileSync('git', ['add', '.gitignore', 'source.ts'], { cwd: root });
    const files = releaseSourceFiles(root);
    const record = {
      files,
      releaseManifestSHA256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    };
    run(root, record);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('runtime outputs do not invalidate source after the browser gate', () =>
  fixture((root, record) => {
    for (const name of [
      '.next',
      'node_modules',
      'supabase/.temp',
      'playwright-report',
      'output/playwright/test-results',
      'output/playwright/visual-results',
    ]) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(join(root, name, 'runtime.txt'), 'ephemeral');
    }
    verifyRelease(root, record);
  }));
test('new non-ignored source still invalidates approval', () =>
  fixture((root, record) => {
    writeFileSync(join(root, 'new-source.ts'), 'new source');
    assert.throws(() => verifyRelease(root, record), /exception is inactive/);
  }));
test('tracked source edits and deletions still invalidate approval', () =>
  fixture((root, record) => {
    writeFileSync(join(root, 'source.ts'), 'changed');
    assert.throws(() => verifyRelease(root, record), /exception is inactive/);
    rmSync(join(root, 'source.ts'));
    assert.throws(() => verifyRelease(root, record));
  }));
test('tracked ignored files remain bound', () =>
  fixture((root) => {
    mkdirSync(join(root, 'playwright-report'));
    writeFileSync(join(root, 'playwright-report', 'tracked.txt'), 'tracked');
    execFileSync('git', ['add', '-f', 'playwright-report/tracked.txt'], { cwd: root });
    const files = releaseSourceFiles(root);
    assert(files.some((file) => file.path === 'playwright-report/tracked.txt'));
    const record = {
      files,
      releaseManifestSHA256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    };
    writeFileSync(join(root, 'playwright-report', 'tracked.txt'), 'changed');
    assert.throws(() => verifyRelease(root, record), /exception is inactive/);
  }));
test('symlink substitution is rejected', () =>
  fixture((root, record) => {
    rmSync(join(root, 'source.ts'));
    symlinkSync('.gitignore', join(root, 'source.ts'));
    assert.throws(() => verifyRelease(root, record), /Unexpected source symlink/);
  }));
