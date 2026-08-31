// @vitest-environment node

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const operationsRoot = new URL('../../../docs/operations/', import.meta.url);

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
});
