import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const advisoryClassId = 27001;
const advisoryObjectId = 27002;

async function psql(sql: string) {
  return execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
}

function holdAdvisoryLock(): ChildProcess {
  return spawn(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      databaseUrl,
      '-c',
      `select pg_advisory_lock(${advisoryClassId}, ${advisoryObjectId}); select pg_sleep(30);`,
    ],
    { stdio: 'ignore' },
  );
}

async function waitForAdvisoryLock(granted: boolean) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { stdout } = await psql(`
      select exists (
        select 1 from pg_locks
        where locktype = 'advisory'
          and classid = ${advisoryClassId}
          and objid = ${advisoryObjectId}
          and granted = ${granted ? 'true' : 'false'}
      )
    `);
    if (stdout.trim() === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for advisory lock granted=${granted}`);
}

async function releaseAdvisoryLockHolder() {
  await psql(`
    select pg_terminate_backend(pid)
    from pg_locks
    where locktype = 'advisory'
      and classid = ${advisoryClassId}
      and objid = ${advisoryObjectId}
      and granted
  `);
}

async function waitForExit(process: ChildProcess) {
  if (process.exitCode !== null) return;
  await new Promise<void>((resolve) => process.once('exit', () => resolve()));
}

type CategoryMutation = 'insert' | 'update' | 'delete';

describe('rubric publication concurrency', () => {
  it.each<CategoryMutation>(['insert', 'update', 'delete'])(
    'serializes %s category mutation before publication validates the total',
    async (mutation) => {
      const organizationId = randomUUID();
      const ownerId = randomUUID();
      const tryoutId = randomUUID();
      const rubricId = randomUUID();
      const versionId = randomUUID();
      const firstCategoryId = randomUUID();
      const secondCategoryId = randomUUID();
      const insertedCategoryId = randomUUID();
      let lockHolder: ChildProcess | undefined;

      const mutationSql = {
        insert: `insert into public.rubric_categories (id, organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max) values ('${insertedCategoryId}', '${organizationId}', '${tryoutId}', '${versionId}', 'Late category', 2, 1, 1, 5);`,
        update: `update public.rubric_categories set weight = 70 where id = '${firstCategoryId}';`,
        delete: `delete from public.rubric_categories where id = '${secondCategoryId}';`,
      }[mutation];

      try {
        await psql(`
          insert into auth.users (id) values ('${ownerId}');
          insert into public.organizations (id, name, slug, timezone)
            values ('${organizationId}', 'Concurrent Club', 'concurrent-club-${organizationId.slice(0, 8)}', 'America/Edmonton');
          insert into public.organization_members (organization_id, user_id, role)
            values ('${organizationId}', '${ownerId}', 'owner');
          insert into public.tryouts (id, organization_id, name, slug, sport, timezone)
            values ('${tryoutId}', '${organizationId}', 'Concurrent Camp', 'concurrent-camp-${tryoutId.slice(0, 8)}', 'Hockey', 'America/Edmonton');
          insert into public.rubrics (id, organization_id, tryout_id, name)
            values ('${rubricId}', '${organizationId}', '${tryoutId}', 'Concurrent rubric');
          insert into public.rubric_versions (id, organization_id, tryout_id, rubric_id, version_number)
            values ('${versionId}', '${organizationId}', '${tryoutId}', '${rubricId}', 1);
          insert into public.rubric_categories (id, organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max)
            values
              ('${firstCategoryId}', '${organizationId}', '${tryoutId}', '${versionId}', 'Speed', 0, 60, 1, 5),
              ('${secondCategoryId}', '${organizationId}', '${tryoutId}', '${versionId}', 'Edges', 1, 40, 1, 5);
        `);

        lockHolder = holdAdvisoryLock();
        await waitForAdvisoryLock(true);
        const mutator = psql(`
          begin;
          ${mutationSql}
          select pg_advisory_lock(${advisoryClassId}, ${advisoryObjectId});
          commit;
        `);
        await waitForAdvisoryLock(false);

        const publisher = psql(`
          set request.jwt.claim.sub = '${ownerId}';
          select outcome from public.publish_rubric_version('${organizationId}', '${rubricId}', 1);
        `);
        await releaseAdvisoryLockHolder();
        await waitForExit(lockHolder);
        lockHolder = undefined;

        const [, publication] = await Promise.all([mutator, publisher]);
        const { stdout: status } = await psql(
          `select status from public.rubric_versions where id = '${versionId}'`,
        );
        expect(status.trim()).toBe('draft');
        expect(publication.stdout).toContain('invalid_draft');
      } finally {
        if (lockHolder) {
          await releaseAdvisoryLockHolder();
          await waitForExit(lockHolder);
        }
        await psql(`
          set session_replication_role = replica;
          delete from public.organizations where id = '${organizationId}';
          delete from auth.users where id = '${ownerId}';
        `);
      }
    },
  );
});
