// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const operationsRoot = new URL('../../../docs/operations/', import.meta.url);
const repositoryRoot = new URL('../../../', import.meta.url);
const execFileAsync = promisify(execFile);

async function runbook(name: string) {
  return readFile(new URL(name, operationsRoot), 'utf8');
}

describe('operations runbooks', () => {
  it('runs empty-fixture pgTAP before restoring the deterministic seed for integration', async () => {
    const [deployment, releaseGate] = await Promise.all([
      runbook('deployment.md'),
      readFile(new URL('scripts/verify-production-readiness.sh', repositoryRoot), 'utf8'),
    ]);

    expect(deployment).toContain('bash scripts/verify-production-readiness.sh');
    const stages = [
      "run_stage 'clean unseeded database reset'",
      "run_stage 'full pgTAP database suite'",
      "run_stage 'deterministic seeded database reset'",
      "run_stage 'supervised integration suite pass 1'",
      "run_stage 'supervised integration suite pass 2'",
    ];
    expect(stages.map((stage) => releaseGate.indexOf(stage))).toEqual(
      expect.toSatisfy((indexes: number[]) =>
        indexes.every(
          (index, position) => index >= 0 && (position === 0 || index > indexes[position - 1]!),
        ),
      ),
    );
  });

  it('keeps production release and retention claims aligned with implemented boundaries', async () => {
    const [environment, privacy] = await Promise.all([
      runbook('environment.md'),
      runbook('privacy-and-retention.md'),
    ]);

    expect(environment).toContain('durable database outbox');
    expect(environment).toContain('approved outbox consumer/retention policy');
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
