// @vitest-environment node

import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const releaseScript = resolve(repositoryRoot, 'scripts/verify-production-readiness.sh');
const temporaryDirectories: string[] = [];

type CommandResult = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}>;

function run(
  command: string,
  arguments_: readonly string[],
  options: Readonly<{ cwd: string; env?: NodeJS.ProcessEnv; timeout?: number }>,
) {
  return new Promise<CommandResult>((resolveRun, rejectRun) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error(`Timed out running ${command} ${arguments_.join(' ')}`));
    }, options.timeout ?? 20_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolveRun({ code, signal, stderr, stdout });
    });
  });
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function createReleaseFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'tryoutflow-release-contract-'));
  temporaryDirectories.push(temporaryRoot);
  const root = join(temporaryRoot, 'repository');
  const fakeBin = join(temporaryRoot, 'bin');
  const commandLog = join(temporaryRoot, 'commands.log');
  await Promise.all([
    mkdir(resolve(root, 'scripts'), { recursive: true }),
    mkdir(resolve(root, 'src/infrastructure/supabase'), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);

  try {
    await copyFile(releaseScript, resolve(root, 'scripts/verify-production-readiness.sh'));
  } catch {
    await writeFile(
      resolve(root, 'scripts/verify-production-readiness.sh'),
      '#!/usr/bin/env bash\nexit 127\n',
    );
  }
  await chmod(resolve(root, 'scripts/verify-production-readiness.sh'), 0o755);
  await Promise.all([
    writeFile(resolve(root, '.env.example'), 'NEXT_PUBLIC_APP_URL=http://localhost:3000\n'),
    writeFile(resolve(root, '.nvmrc'), '24.12.0\n'),
    writeFile(
      resolve(root, 'package.json'),
      JSON.stringify({ packageManager: 'npm@11.12.1', devDependencies: { supabase: '2.116.0' } }),
    ),
    writeFile(resolve(root, 'package-lock.json'), '{"lockfileVersion":3}\n'),
    writeFile(
      resolve(root, 'src/infrastructure/supabase/database.types.ts'),
      'export type Database = never;\n',
    ),
    writeFile(
      resolve(fakeBin, 'corepack'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TRYOUTFLOW_COMMAND_LOG"
if [[ "$*" == "npm@11.12.1 --version" ]]; then printf '11.12.1\\n'; fi
if [[ "$*" == "npm@11.12.1 exec -- supabase --version" ]]; then printf '2.116.0\\n'; fi
if [[ -n "\${TRYOUTFLOW_FAIL_COMMAND:-}" && "$*" == "$TRYOUTFLOW_FAIL_COMMAND" ]]; then exit 37; fi
if [[ -n "\${TRYOUTFLOW_BLOCK_MARKER:-}" && "$*" == "npm@11.12.1 ci" ]]; then
  : > "$TRYOUTFLOW_BLOCK_MARKER"
  while [[ ! -f "$TRYOUTFLOW_BLOCK_RELEASE" ]]; do sleep 0.025; done
fi
`,
    ),
  ]);
  await chmod(resolve(fakeBin, 'corepack'), 0o755);

  for (const arguments_ of [
    ['init', '--quiet'],
    ['config', 'user.email', 'release-contract@example.test'],
    ['config', 'user.name', 'Release Contract'],
    ['add', '.'],
    ['commit', '--quiet', '-m', 'fixture'],
  ]) {
    const result = await run('git', arguments_, { cwd: root });
    expect(result.code, result.stderr).toBe(0);
  }

  return {
    commandLog,
    environment: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      TRYOUTFLOW_COMMAND_LOG: commandLog,
    },
    root,
    script: resolve(root, 'scripts/verify-production-readiness.sh'),
    temporaryRoot,
  };
}

async function loggedCommands(path: string) {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('production readiness release gate', () => {
  it('executes the hardened pinned gates in deterministic order', async () => {
    const fixture = await createReleaseFixture();
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: fixture.environment,
    });

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await loggedCommands(fixture.commandLog)).toEqual([
      'npm@11.12.1 --version',
      'npm@11.12.1 ci',
      'npm@11.12.1 --version',
      'npm@11.12.1 exec -- supabase --version',
      'npm@11.12.1 run release:state:preflight',
      'npm@11.12.1 run format:check',
      'npm@11.12.1 run lint',
      'npm@11.12.1 run typecheck',
      'npm@11.12.1 exec -- supabase db reset --local --no-seed',
      'npm@11.12.1 run test:db',
      'npm@11.12.1 run db:types',
      'npm@11.12.1 run db:types',
      'npm@11.12.1 exec -- supabase db reset --local',
      'npm@11.12.1 run test:unit',
      'npm@11.12.1 run test:integration',
      'npm@11.12.1 run test:integration',
      'npm@11.12.1 run test:contract',
      'npm@11.12.1 run build',
      'npm@11.12.1 run test:marketing:production',
      'npm@11.12.1 run test:e2e -- --retries=0',
      'npm@11.12.1 audit --audit-level=high',
      'npm@11.12.1 exec -- supabase db reset --local --no-seed',
      'npm@11.12.1 run release:state:residue',
    ]);
    expect(result.stdout).toContain('Production readiness automated gate passed');
  });

  it('stops at the first failed owning command', async () => {
    const fixture = await createReleaseFixture();
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: {
        ...fixture.environment,
        TRYOUTFLOW_FAIL_COMMAND: 'npm@11.12.1 run typecheck',
      },
    });

    expect(result.code).toBe(37);
    const commands = await loggedCommands(fixture.commandLog);
    expect(commands.at(-1)).toBe('npm@11.12.1 run typecheck');
    expect(commands).not.toContain('npm@11.12.1 exec -- supabase db reset --local --no-seed');
    expect(result.stderr).toContain('FAILED: typecheck');
  });

  it('allows only one gate to own a repository at a time', async () => {
    const fixture = await createReleaseFixture();
    const marker = join(fixture.temporaryRoot, 'blocked');
    const release = join(fixture.temporaryRoot, 'release');
    const environment = {
      ...fixture.environment,
      TRYOUTFLOW_BLOCK_MARKER: marker,
      TRYOUTFLOW_BLOCK_RELEASE: release,
    };
    const first = run('bash', [fixture.script], {
      cwd: fixture.root,
      env: environment,
      timeout: 20_000,
    });
    await waitForFile(marker);

    const second = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: environment,
      timeout: 5_000,
    });
    expect(second.code).not.toBe(0);

    await writeFile(release, 'continue\n');
    const firstResult = await first;
    expect(firstResult.code, `${firstResult.stdout}\n${firstResult.stderr}`).toBe(0);
  });

  it('cleans the local release state after a failure once database work begins', async () => {
    const fixture = await createReleaseFixture();
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: {
        ...fixture.environment,
        TRYOUTFLOW_FAIL_COMMAND: 'npm@11.12.1 run test:e2e -- --retries=0',
      },
    });

    expect(result.code).toBe(37);
    const commands = await loggedCommands(fixture.commandLog);
    expect(commands.at(-2)).toBe('npm@11.12.1 exec -- supabase db reset --local --no-seed');
    expect(commands.at(-1)).toBe('npm@11.12.1 run release:state:residue');
    expect(commands).not.toContain('npm@11.12.1 audit --audit-level=high');
    expect(result.stderr).toContain('FAILED: strict five-project browser gate');
    expect(result.stdout).toContain('failure cleanup: clean unseeded database reset');
    expect(result.stdout).toContain('failure cleanup: residue audit');
  });

  it('rejects any local process, database, auth, or fixture residue count', async () => {
    const moduleUrl = pathToFileURL(resolve(repositoryRoot, 'scripts/verify-release-state.mjs'));
    const imported = await import(moduleUrl.href);
    const clean = {
      authUsers: 0,
      fixtureDatabases: 0,
      fixtureOrganizations: 0,
      fixtureRoles: 0,
      fixtureSchemas: 0,
      fixtureSessions: 0,
      fixtureTriggers: 0,
      organizations: 0,
      rateCounters: 0,
    };

    expect(() => imported.assertNoReleaseResidue(clean, false)).not.toThrow();
    for (const key of Object.keys(clean)) {
      expect(() => imported.assertNoReleaseResidue({ ...clean, [key]: 1 }, false)).toThrow(
        `Release residue remains: ${key}=1`,
      );
    }
    expect(() => imported.assertNoReleaseResidue(clean, true)).toThrow(
      'Release residue remains: application port 3112 is listening',
    );
  });
});

describe('release evidence documentation', () => {
  it('maps every specification area and acceptance criterion to evidence', async () => {
    const checklist = await readFile(
      resolve(repositoryRoot, 'docs/operations/release-checklist.md'),
      'utf8',
    );

    for (let index = 1; index <= 21; index += 1) {
      expect(
        checklist.match(new RegExp(`\\| S${String(index).padStart(2, '0')} \\|`, 'gu')),
      ).toHaveLength(1);
    }
    for (let index = 1; index <= 17; index += 1) {
      expect(
        checklist.match(new RegExp(`\\| AC${String(index).padStart(2, '0')} \\|`, 'gu')),
      ).toHaveLength(1);
    }
    expect(checklist).toContain('bash scripts/verify-production-readiness.sh');
    expect(checklist).toContain('Hardened-interface ruling');
  });

  it('keeps every external production prerequisite explicitly incomplete', async () => {
    const checklist = await readFile(
      resolve(repositoryRoot, 'docs/operations/release-checklist.md'),
      'utf8',
    );
    const manualPrerequisites = [
      'legal/privacy approval',
      'production domains, DNS, and TLS',
      'Stripe live credentials, delivery, and certification',
      'Resend credentials, domain delivery, and certification',
      'The Squad credentials, delivery, and certification',
      'hosted backup and restore drill',
      'production monitoring and alert ownership',
      'deployed authenticated smoke test',
    ];

    for (const prerequisite of manualPrerequisites) {
      expect(checklist).toContain(`- [ ] ${prerequisite}`);
    }
    expect(checklist).not.toMatch(
      /- \[x\] (?:legal\/privacy|production domains|Stripe|Resend|The Squad|hosted backup|production monitoring|deployed authenticated)/iu,
    );
  });

  it('documents the pinned local workflow and one release command without claiming deployment', async () => {
    const [readme, workflow] = await Promise.all([
      readFile(resolve(repositoryRoot, 'README.md'), 'utf8'),
      readFile(resolve(repositoryRoot, '.github/workflows/ci.yml'), 'utf8'),
    ]);

    expect(readme).toContain('Node.js 24.12.0');
    expect(readme).toContain('npm 11.12.1');
    expect(readme).toContain('Supabase CLI 2.116.0');
    expect(readme.match(/bash scripts\/verify-production-readiness\.sh/gu)).toHaveLength(1);
    expect(readme).toContain('does not deploy');
    expect(readme.split('\n').length).toBeLessThanOrEqual(140);
    expect(workflow.match(/bash scripts\/verify-production-readiness\.sh/gu)).toHaveLength(1);
  });
});
