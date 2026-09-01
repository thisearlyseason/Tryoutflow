// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const operationsRoot = new URL('../../../docs/operations/', import.meta.url);
const execFileAsync = promisify(execFile);

async function runbook(name: string) {
  return readFile(new URL(name, operationsRoot), 'utf8');
}

describe('operations runbooks', () => {
  it('runs empty-fixture pgTAP before restoring the deterministic seed for integration', async () => {
    const deployment = await runbook('deployment.md');

    expect(deployment).toContain(
      [
        'npx supabase db reset --local --no-seed',
        'npm run test:db',
        'npm run supabase:reset',
        'npm run test:integration',
        'npm run test:integration',
      ].join('\n'),
    );
  });

  it('keeps production release and retention claims aligned with implemented boundaries', async () => {
    const [environment, privacy] = await Promise.all([
      runbook('environment.md'),
      runbook('privacy-and-retention.md'),
    ]);

    expect(environment).toContain('deterministic fake analytics adapter');
    expect(environment).toContain('Do not onboard real organizations until all are signed off');
    expect(privacy).toContain('does not invent a retention period');
    expect(privacy).toContain('Production launch is blocked');
  });

  it('executes the canonical browser release command with exactly zero retries', async () => {
    let stdout = '';
    const outputDirectory = await mkdtemp(join(tmpdir(), 'tryoutflow-release-retry-'));
    try {
      try {
        await execFileAsync(
          'npm',
          [
            '--silent',
            'run',
            'test:e2e',
            '--',
            '--config=tests/fixtures/release-e2e/playwright.config.ts',
            '--reporter=json',
          ],
          {
            cwd: new URL('../../../', import.meta.url),
            env: { ...process.env, TRYOUTFLOW_RELEASE_RETRY_OUTPUT: outputDirectory },
            timeout: 30_000,
          },
        );
        throw new Error('intentional release fixture unexpectedly passed');
      } catch (error) {
        stdout = String((error as { stdout?: string }).stdout ?? '');
      }
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
    const report = JSON.parse(stdout) as {
      suites: Array<{ specs: Array<{ tests: Array<{ results: unknown[] }> }> }>;
    };

    expect(report.suites[0]?.specs[0]?.tests[0]?.results).toHaveLength(1);
  }, 30_000);
});
