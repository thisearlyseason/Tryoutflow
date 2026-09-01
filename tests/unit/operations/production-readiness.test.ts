// @vitest-environment node

import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const releaseScript = resolve(repositoryRoot, 'scripts/verify-production-readiness.sh');
const releaseStageRunner = resolve(repositoryRoot, 'scripts/lib/release-stage-runner.sh');
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
    mkdir(resolve(root, 'scripts/lib'), { recursive: true }),
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
  await copyFile(releaseStageRunner, resolve(root, 'scripts/lib/release-stage-runner.sh')).catch(
    () => undefined,
  );
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
      resolve(fakeBin, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'node %s\\n' "$*" >> "$TRYOUTFLOW_COMMAND_LOG"
if [[ "$*" == "--version" ]]; then printf '%s\\n' "\${TRYOUTFLOW_NODE_VERSION:-v24.12.0}"; exit 0; fi
exit 64
`,
    ),
    writeFile(
      resolve(fakeBin, 'corepack'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TRYOUTFLOW_COMMAND_LOG"
if [[ -n "\${TRYOUTFLOW_FAIL_COMMAND:-}" && "$*" == "$TRYOUTFLOW_FAIL_COMMAND" ]]; then exit "\${TRYOUTFLOW_FAIL_CODE:-37}"; fi
if [[ "$*" == "npm@11.12.1 --version" ]]; then
  if [[ -f "\${TRYOUTFLOW_INSTALL_MARKER:-/dev/null}" ]]; then
    printf '%s\\n' "\${TRYOUTFLOW_POSTINSTALL_NPM_VERSION:-11.12.1}"
  else
    printf '%s\\n' "\${TRYOUTFLOW_NPM_VERSION:-11.12.1}"
  fi
fi
if [[ "$*" == "npm@11.12.1 exec -- supabase --version" ]]; then printf '%s\\n' "\${TRYOUTFLOW_SUPABASE_VERSION:-2.116.0}"; fi
if [[ "$*" == "npm@11.12.1 ci" && -n "\${TRYOUTFLOW_INSTALL_MARKER:-}" ]]; then : > "$TRYOUTFLOW_INSTALL_MARKER"; fi
if [[ -n "\${TRYOUTFLOW_BLOCK_MARKER:-}" && "$*" == "npm@11.12.1 ci" ]]; then
  : > "$TRYOUTFLOW_BLOCK_MARKER"
  while [[ ! -f "$TRYOUTFLOW_BLOCK_RELEASE" ]]; do sleep 0.025; done
fi
`,
    ),
    writeFile(
      resolve(fakeBin, 'git'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "diff --check" && -n "\${TRYOUTFLOW_FAIL_GIT_DIFF_CODE:-}" ]]; then
  : > "$TRYOUTFLOW_GIT_DIFF_FAILED_MARKER"
  exit "$TRYOUTFLOW_FAIL_GIT_DIFF_CODE"
fi
if [[ "$*" == "status --porcelain=v1 --untracked-files=all" && -n "\${TRYOUTFLOW_GIT_DIFF_FAILED_MARKER:-}" && -f "$TRYOUTFLOW_GIT_DIFF_FAILED_MARKER" ]]; then
  : > "$TRYOUTFLOW_LATER_GIT_MARKER"
fi
exec "$TRYOUTFLOW_REAL_GIT" "$@"
`,
    ),
  ]);
  await Promise.all(
    ['corepack', 'git', 'node'].map((command) => chmod(resolve(fakeBin, command), 0o755)),
  );

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
      TRYOUTFLOW_REAL_GIT: '/usr/bin/git',
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
      'node --version',
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
      'npm@11.12.1 run demo:local',
      'npm@11.12.1 run test:visual',
      'npm@11.12.1 run test:e2e -- --retries=0',
      'npm@11.12.1 audit --audit-level=high',
      'npm@11.12.1 exec -- supabase db reset --local --no-seed',
      'npm@11.12.1 run release:state:residue',
    ]);
    expect(result.stdout).toContain('Production readiness automated gate passed');
    const script = await readFile(releaseScript, 'utf8');
    const gitignore = await readFile(join(repositoryRoot, '.gitignore'), 'utf8');
    expect(script).toContain("run_stage 'canonical visual regression'");
    expect(script).not.toContain('--update-snapshots');
    expect(gitignore).toContain('output/playwright/*-results/');
  });

  it('rejects the wrong Node before checking npm or installing dependencies', async () => {
    const fixture = await createReleaseFixture();
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: { ...fixture.environment, TRYOUTFLOW_NODE_VERSION: 'v23.0.0' },
    });

    expect(result.code).toBe(1);
    expect(await loggedCommands(fixture.commandLog)).toEqual(['node --version']);
    expect(result.stdout).toContain('CHECK: pinned Node identity');
    expect(result.stderr).toContain('FAILED: pinned Node identity');
    expect(result.stdout).not.toContain('clean dependency installation');
  });

  it('rejects the wrong pre-install npm before installing dependencies', async () => {
    const fixture = await createReleaseFixture();
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: { ...fixture.environment, TRYOUTFLOW_NPM_VERSION: '10.9.0' },
    });

    expect(result.code).toBe(1);
    expect(await loggedCommands(fixture.commandLog)).toEqual([
      'node --version',
      'npm@11.12.1 --version',
    ]);
    expect(result.stdout).toContain('CHECK: pinned npm pre-install identity');
    expect(result.stderr).toContain('FAILED: pinned npm pre-install identity');
    expect(result.stdout).not.toContain('clean dependency installation');
  });

  it('rejects the wrong post-install npm before checking Supabase', async () => {
    const fixture = await createReleaseFixture();
    const installMarker = join(fixture.temporaryRoot, 'installed');
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: {
        ...fixture.environment,
        TRYOUTFLOW_INSTALL_MARKER: installMarker,
        TRYOUTFLOW_POSTINSTALL_NPM_VERSION: '10.9.0',
      },
    });

    expect(result.code).toBe(1);
    expect(await loggedCommands(fixture.commandLog)).toEqual([
      'node --version',
      'npm@11.12.1 --version',
      'npm@11.12.1 ci',
      'npm@11.12.1 --version',
    ]);
    expect(result.stdout).toContain('CHECK: pinned npm post-install identity');
    expect(result.stderr).toContain('FAILED: pinned npm post-install identity');
    expect(result.stdout).not.toContain('local Supabase identity proof');
  });

  it('rejects the wrong Supabase version before the local identity preflight', async () => {
    const fixture = await createReleaseFixture();
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: { ...fixture.environment, TRYOUTFLOW_SUPABASE_VERSION: '2.115.0' },
    });

    expect(result.code).toBe(1);
    const commands = await loggedCommands(fixture.commandLog);
    expect(commands.at(-1)).toBe('npm@11.12.1 exec -- supabase --version');
    expect(commands).not.toContain('npm@11.12.1 run release:state:preflight');
    expect(result.stdout).toContain('CHECK: pinned Supabase CLI identity');
    expect(result.stderr).toContain('FAILED: pinned Supabase CLI identity');
  });

  it('preserves a missing Supabase command status and prevents later stages', async () => {
    const fixture = await createReleaseFixture();
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: {
        ...fixture.environment,
        TRYOUTFLOW_FAIL_CODE: '127',
        TRYOUTFLOW_FAIL_COMMAND: 'npm@11.12.1 exec -- supabase --version',
      },
    });

    expect(result.code).toBe(127);
    const commands = await loggedCommands(fixture.commandLog);
    expect(commands.at(-1)).toBe('npm@11.12.1 exec -- supabase --version');
    expect(commands).not.toContain('npm@11.12.1 run release:state:preflight');
    expect(result.stderr).toContain('pinned Supabase CLI identity command failed (exit 127)');
    expect(result.stdout).not.toContain('Production readiness automated gate passed');
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

  it('preserves git diff --check failure and runs failure cleanup exactly once', async () => {
    const fixture = await createReleaseFixture();
    const diffFailedMarker = join(fixture.temporaryRoot, 'git-diff-failed');
    const laterGitMarker = join(fixture.temporaryRoot, 'later-git-command');
    const result = await run('bash', [fixture.script], {
      cwd: fixture.root,
      env: {
        ...fixture.environment,
        TRYOUTFLOW_FAIL_GIT_DIFF_CODE: '43',
        TRYOUTFLOW_GIT_DIFF_FAILED_MARKER: diffFailedMarker,
        TRYOUTFLOW_LATER_GIT_MARKER: laterGitMarker,
      },
    });

    expect(result.code).toBe(43);
    await expect(readFile(diffFailedMarker, 'utf8')).resolves.toBe('');
    await expect(readFile(laterGitMarker, 'utf8')).rejects.toThrow();
    expect(result.stdout.match(/failure cleanup: clean unseeded database reset/gu)).toHaveLength(1);
    expect(result.stdout.match(/failure cleanup: residue audit/gu)).toHaveLength(1);
    expect(result.stdout).not.toContain('Production readiness automated gate passed');
  });

  it('rejects any local process, database, auth, or fixture residue count', async () => {
    const moduleUrl = pathToFileURL(resolve(repositoryRoot, 'scripts/verify-release-state.mjs'));
    const imported = await import(moduleUrl.href);
    const clean = {
      abuseRateLimits: 0,
      analyticsOutboxEvents: 0,
      authUsers: 0,
      botTokenReceipts: 0,
      fixtureDatabases: 0,
      fixtureOrganizations: 0,
      fixtureRoles: 0,
      fixtureSchemas: 0,
      fixtureSessions: 0,
      fixtureTriggers: 0,
      membershipCommandReceipts: 0,
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

describe('release stage runner', () => {
  it.each([
    ['first', 31, ['first']],
    ['middle', 32, ['first', 'middle']],
    ['last', 33, ['first', 'middle', 'last']],
  ] as const)(
    'stops a function at its %s failing command, preserves status, and cleans once',
    async (position, expectedCode, expectedTrace) => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'tryoutflow-stage-runner-'));
      temporaryDirectories.push(temporaryRoot);
      const harness = join(temporaryRoot, 'harness.sh');
      const trace = join(temporaryRoot, 'trace');
      const cleanup = join(temporaryRoot, 'cleanup');
      const later = join(temporaryRoot, 'later');
      await writeFile(
        harness,
        `#!/usr/bin/env bash
set -euo pipefail
source "$TRYOUTFLOW_STAGE_RUNNER"
stage_number=0
trap 'printf "cleanup\\n" >> "$TRYOUTFLOW_CLEANUP"' EXIT
first_command() { printf 'first\\n' >> "$TRYOUTFLOW_TRACE"; [[ "$TRYOUTFLOW_FAIL_POSITION" != 'first' ]] || return 31; }
middle_command() { printf 'middle\\n' >> "$TRYOUTFLOW_TRACE"; [[ "$TRYOUTFLOW_FAIL_POSITION" != 'middle' ]] || return 32; }
last_command() { printf 'last\\n' >> "$TRYOUTFLOW_TRACE"; [[ "$TRYOUTFLOW_FAIL_POSITION" != 'last' ]] || return 33; }
stage_function() { first_command; middle_command; last_command; }
run_stage 'behavioral function failure' stage_function
: > "$TRYOUTFLOW_LATER"
`,
      );

      const result = await run('bash', [harness], {
        cwd: temporaryRoot,
        env: {
          ...process.env,
          TRYOUTFLOW_CLEANUP: cleanup,
          TRYOUTFLOW_FAIL_POSITION: position,
          TRYOUTFLOW_LATER: later,
          TRYOUTFLOW_STAGE_RUNNER: releaseStageRunner,
          TRYOUTFLOW_TRACE: trace,
        },
      });

      expect(result.code).toBe(expectedCode);
      expect((await readFile(trace, 'utf8')).trim().split('\n')).toEqual(expectedTrace);
      expect((await readFile(cleanup, 'utf8')).trim().split('\n')).toEqual(['cleanup']);
      await expect(readFile(later, 'utf8')).rejects.toThrow();
      expect(result.stderr).toContain(
        `FAILED: behavioral function failure (exit ${String(expectedCode)})`,
      );
    },
  );
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
      'production Supabase Auth configuration',
      'Cloudflare Turnstile production site key',
      'Stripe live credentials, delivery, and certification',
      'Resend credentials, domain delivery, and certification',
      'The Squad credentials, delivery, and certification',
      'hosted backup and restore drill',
      'production monitoring and alert ownership',
      'deployed anonymous and authenticated smoke test',
      'production performance and load certification',
    ];

    for (const prerequisite of manualPrerequisites) {
      expect(checklist).toContain(`- [ ] ${prerequisite}`);
    }
    expect(checklist).not.toMatch(
      /- \[x\] (?:legal\/privacy|production domains|production Supabase Auth|Cloudflare Turnstile|Stripe|Resend|The Squad|hosted backup|production monitoring|deployed anonymous)/iu,
    );
  });

  it('maps each approved performance requirement without claiming hosted certification', async () => {
    const checklist = await readFile(
      resolve(repositoryRoot, 'docs/operations/release-checklist.md'),
      'utf8',
    );

    for (let index = 1; index <= 6; index += 1) {
      expect(
        checklist.match(new RegExp(`\\| P${String(index).padStart(2, '0')} \\|`, 'gu')),
      ).toHaveLength(1);
    }
    expect(checklist).toContain('- [ ] production performance and load certification');
    expect(checklist).toContain('named engineering/operations owner');
    expect(checklist).toContain('dated production-like evidence');
    expect(checklist).not.toMatch(
      /(?:load|performance) certification (?:is )?(?:complete|passed)/iu,
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
    expect(readme).toContain('Early read-only failures do not modify or clean');
    expect(readme).toContain('After owned database work begins');
    expect(readme).not.toContain('after success or failure');
    expect(readme.split('\n').length).toBeLessThanOrEqual(140);
    expect(workflow.match(/bash scripts\/verify-production-readiness\.sh/gu)).toHaveLength(1);
  });
});
