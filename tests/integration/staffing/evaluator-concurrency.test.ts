// @vitest-environment node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string, applicationName = 'tryoutflow-staffing-integration') =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql], {
    env: { ...process.env, PGAPPNAME: applicationName },
  });
const psqlAsRole = (role: string, sql: string) =>
  execFile(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', `set role ${role}`, '-c', sql],
    { env: { ...process.env, PGAPPNAME: 'tryoutflow-staffing-acl' } },
  );

const waitForOutput = (child: ReturnType<typeof spawn>, expected: string) =>
  new Promise<void>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(expected)) resolve();
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', (code) => {
      if (!stdout.includes(expected)) reject(new Error(`psql exited ${code}: ${stderr}`));
    });
  });

const waitForBlockingEdge = async (blockedName: string, blockerName: string) => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await psql(`
      select waiting.locktype||'|'||waiting.mode
      from pg_stat_activity blocked
      join pg_stat_activity blocker on blocker.application_name='${blockerName}'
      join pg_locks waiting on waiting.pid=blocked.pid and not waiting.granted
      where blocked.application_name='${blockedName}'
        and blocker.pid=any(pg_blocking_pids(blocked.pid))
      order by waiting.locktype,waiting.mode limit 1
    `);
    if (result.stdout.trim()) return result.stdout.trim();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${blockedName} was not blocked by ${blockerName}`);
};

const startSession = (applicationName: string) =>
  spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl], {
    env: { ...process.env, PGAPPNAME: applicationName },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

const stopSessions = async (sessions: ReturnType<typeof spawn>[], names: string[]) => {
  for (const child of sessions) {
    if (child.exitCode === null && child.stdin && !child.stdin.destroyed) {
      try {
        child.stdin.write('\nrollback;\n\\q\n');
      } catch {
        // Backend termination below is the unconditional rollback fallback.
      }
    }
  }
  if (names.length > 0) {
    await psql(
      `select pg_terminate_backend(pid) from pg_stat_activity where pid<>pg_backend_pid() and application_name=any(array[${names.map((name) => `'${name}'`).join(',')}])`,
      'tryoutflow-staffing-cleanup',
    ).catch(() => undefined);
  }
  for (const child of sessions) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  await Promise.allSettled(
    sessions.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) return resolve();
          const timer = setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
            resolve();
          }, 1_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
};

describe('evaluator assignment membership serialization', () => {
  it.each(['anon', 'authenticated', 'service_role'])(
    'denies direct MAINTAIN to %s at runtime',
    async (role) => {
      await expect(
        psqlAsRole(role, 'vacuum public.tryout_staff_assignments'),
      ).resolves.toMatchObject({ stderr: expect.stringMatching(/permission denied.*skipping/su) });
    },
  );

  it('serializes duplicate assignment and assign-vs-disable/delete on the membership row', async () => {
    const owner = randomUUID();
    const evaluators = [randomUUID(), randomUUID(), randomUUID()];
    const organization = randomUUID();
    const tryout = randomUUID();
    const suffix = tryout.slice(0, 8);
    const sessions: ReturnType<typeof spawn>[] = [];
    const names: string[] = [];
    const callAssign = (evaluator: string, applicationName: string) =>
      psql(
        `begin; set local statement_timeout='10s'; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true); create temporary table rpc_result on commit preserve rows as select outcome from public.assign_evaluator('${organization}','${evaluator}','${tryout}','tryout',null,null,null,null); commit; select outcome from rpc_result;`,
        applicationName,
      );

    try {
      await psql(`
        insert into auth.users(id) values('${owner}'),('${evaluators[0]}'),('${evaluators[1]}'),('${evaluators[2]}');
        insert into public.organizations(id,name,slug,timezone)
          values('${organization}','Concurrent Staffing','concurrent-staffing-${suffix}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organization}','${owner}','owner','active'),
          ('${organization}','${evaluators[0]}','member','active'),
          ('${organization}','${evaluators[1]}','member','active'),
          ('${organization}','${evaluators[2]}','member','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
          values('${tryout}','${organization}','Concurrent Camp','concurrent-camp-${suffix}','Hockey','America/Edmonton');
      `);

      const assignmentKey = async (evaluator: string) =>
        (
          await psql(
            `select hashtextextended(concat_ws(':','evaluator-assignment','${organization}'::uuid,'${evaluator}'::uuid,'${tryout}'::uuid,'tryout',null,null,null),0)`,
          )
        ).stdout.trim();

      // Two assigners: first owns the membership row while waiting on the exact
      // scope key; second must queue on that membership row and observe duplicate.
      const duplicateHolderName = `staffing-holder-${suffix}`;
      const firstName = `staffing-first-${suffix}`;
      const secondName = `staffing-second-${suffix}`;
      names.push(duplicateHolderName, firstName, secondName);
      const duplicateHolder = startSession(duplicateHolderName);
      sessions.push(duplicateHolder);
      const duplicateKey = await assignmentKey(evaluators[0]!);
      duplicateHolder.stdin?.write(
        `select pg_advisory_lock(${duplicateKey}); select 'holder_ready';\n`,
      );
      await waitForOutput(duplicateHolder, 'holder_ready');
      const first = callAssign(evaluators[0]!, firstName);
      expect(await waitForBlockingEdge(firstName, duplicateHolderName)).toMatch(/advisory/u);
      const second = callAssign(evaluators[0]!, secondName);
      expect(await waitForBlockingEdge(secondName, firstName)).toMatch(/transactionid|tuple/u);
      duplicateHolder.stdin?.write(`select pg_advisory_unlock(${duplicateKey});\n\\q\n`);
      const duplicateOutcomes = await Promise.all([first, second]);
      expect(duplicateOutcomes.map((result) => result.stdout).join('\n')).toContain('assigned');
      expect(duplicateOutcomes.map((result) => result.stdout).join('\n')).toContain('duplicate');
      expect(
        (
          await psql(
            `select count(*) from public.tryout_staff_assignments where organization_id='${organization}' and user_id='${evaluators[0]}' and revoked_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');

      // Assign-first: disabling queues behind the membership lock, then revokes
      // the just-created grant after assignment commits.
      const disableHolderName = `staffing-disable-holder-${suffix}`;
      const assignBeforeDisableName = `staffing-assign-before-disable-${suffix}`;
      const disableName = `staffing-disable-${suffix}`;
      names.push(disableHolderName, assignBeforeDisableName, disableName);
      const disableHolder = startSession(disableHolderName);
      sessions.push(disableHolder);
      const disableKey = await assignmentKey(evaluators[1]!);
      disableHolder.stdin?.write(
        `select pg_advisory_lock(${disableKey}); select 'holder_ready';\n`,
      );
      await waitForOutput(disableHolder, 'holder_ready');
      const assignBeforeDisable = callAssign(evaluators[1]!, assignBeforeDisableName);
      await waitForBlockingEdge(assignBeforeDisableName, disableHolderName);
      const disable = psql(
        `update public.organization_members set status='disabled' where organization_id='${organization}' and user_id='${evaluators[1]}'`,
        disableName,
      );
      expect(await waitForBlockingEdge(disableName, assignBeforeDisableName)).toMatch(
        /transactionid|tuple/u,
      );
      disableHolder.stdin?.write(`select pg_advisory_unlock(${disableKey});\n\\q\n`);
      await expect(assignBeforeDisable).resolves.toMatchObject({
        stdout: expect.stringContaining('assigned'),
      });
      await disable;
      expect(
        (
          await psql(
            `select count(*) from public.tryout_staff_assignments where organization_id='${organization}' and user_id='${evaluators[1]}' and revoked_at is null`,
          )
        ).stdout.trim(),
      ).toBe('0');

      // Delete-first: a hard membership delete owns the same row. The assigner
      // waits, then returns not_member without creating a grant.
      const deleteName = `staffing-delete-${suffix}`;
      const assignAfterDeleteName = `staffing-assign-after-delete-${suffix}`;
      names.push(deleteName, assignAfterDeleteName);
      const deleteSession = startSession(deleteName);
      sessions.push(deleteSession);
      deleteSession.stdin?.write(
        `begin; delete from public.organization_members where organization_id='${organization}' and user_id='${evaluators[2]}'; select 'delete_ready';\n`,
      );
      await waitForOutput(deleteSession, 'delete_ready');
      const assignAfterDelete = callAssign(evaluators[2]!, assignAfterDeleteName);
      expect(await waitForBlockingEdge(assignAfterDeleteName, deleteName)).toMatch(
        /transactionid|tuple/u,
      );
      deleteSession.stdin?.write('commit;\n\\q\n');
      await expect(assignAfterDelete).resolves.toMatchObject({
        stdout: expect.stringContaining('not_member'),
      });
      expect(
        (
          await psql(
            `select count(*) from public.tryout_staff_assignments where organization_id='${organization}' and user_id='${evaluators[2]}'`,
          )
        ).stdout.trim(),
      ).toBe('0');
    } finally {
      await stopSessions(sessions, names);
      await psql(`
        set session_replication_role=replica;
        delete from public.audit_logs where organization_id='${organization}';
        delete from public.tryout_staff_assignments where organization_id='${organization}';
        delete from public.tryouts where organization_id='${organization}';
        delete from public.organization_members where organization_id='${organization}';
        delete from public.organizations where id='${organization}';
        delete from auth.users where id in ('${owner}','${evaluators[0]}','${evaluators[1]}','${evaluators[2]}');
        set session_replication_role=origin;
      `).catch(() => undefined);
    }
  }, 30_000);
});
