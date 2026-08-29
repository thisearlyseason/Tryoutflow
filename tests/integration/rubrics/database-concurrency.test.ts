import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type AdvisoryKey = Readonly<{
  classId: number;
  objectId: number;
}>;

async function psql(sql: string) {
  return execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
}

function createAdvisoryKey(caseId: string): AdvisoryKey {
  const hex = caseId.replaceAll('-', '');

  return {
    classId: Number.parseInt(hex.slice(0, 8), 16) & 0x7fffffff,
    objectId: Number.parseInt(hex.slice(8, 16), 16) & 0x7fffffff,
  };
}

function holdAdvisoryLock(key: AdvisoryKey, applicationName: string): ChildProcess {
  return spawn(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      databaseUrl,
      '-c',
      `set application_name = '${applicationName}'; select pg_advisory_lock(${key.classId}, ${key.objectId}); select pg_sleep(30);`,
    ],
    { stdio: 'ignore' },
  );
}

async function findAdvisoryLockHolderPid(key: AdvisoryKey, applicationName: string) {
  const { stdout } = await psql(`
      select locks.pid from pg_locks as locks
        join pg_stat_activity as activity on activity.pid = locks.pid
        where locktype = 'advisory'
          and classid = ${key.classId}
          and objid = ${key.objectId}
          and activity.application_name = '${applicationName}'
          and granted
    `);
  const holderPid = Number(stdout.trim());

  return Number.isInteger(holderPid) && holderPid > 0 ? holderPid : undefined;
}

async function waitForAdvisoryLockHolder(key: AdvisoryKey, applicationName: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const holderPid = await findAdvisoryLockHolderPid(key, applicationName);
    if (holderPid !== undefined) return holderPid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for the advisory lock holder');
}

async function waitForAdvisoryLockWaiter(key: AdvisoryKey) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { stdout } = await psql(`
      select exists (
        select 1 from pg_locks
        where locktype = 'advisory'
          and classid = ${key.classId}
          and objid = ${key.objectId}
          and not granted
      )
    `);
    if (stdout.trim() === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for the advisory lock waiter');
}

async function waitForPublisherBlocked(
  publisherApplicationName: string,
  mutatorApplicationName: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { stdout } = await psql(`
      select exists (
        select 1
        from pg_stat_activity as publisher
        join pg_stat_activity as mutator
          on mutator.application_name = '${mutatorApplicationName}'
        where publisher.application_name = '${publisherApplicationName}'
          and publisher.wait_event_type = 'Lock'
          and mutator.pid = any(pg_blocking_pids(publisher.pid))
      )
    `);
    if (stdout.trim() === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for publisher to block on the mutator parent lock');
}

async function releaseAdvisoryLockHolder(holderPid: number, key: AdvisoryKey) {
  await psql(`
    select pg_terminate_backend(${holderPid})
    from pg_locks
    where locktype = 'advisory'
      and pid = ${holderPid}
      and classid = ${key.classId}
      and objid = ${key.objectId}
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
      const caseId = randomUUID();
      const advisoryKey = createAdvisoryKey(caseId);
      const holderApplicationName = `tryoutflow-holder-${caseId}`;
      const mutatorApplicationName = `tryoutflow-mutator-${caseId}`;
      const publisherApplicationName = `tryoutflow-publisher-${caseId}`;
      let lockHolder: ChildProcess | undefined;
      let lockHolderPid: number | undefined;

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

        lockHolder = holdAdvisoryLock(advisoryKey, holderApplicationName);
        lockHolderPid = await waitForAdvisoryLockHolder(advisoryKey, holderApplicationName);
        const mutator = psql(`
          set application_name = '${mutatorApplicationName}';
          begin;
          ${mutationSql}
          select pg_advisory_lock(${advisoryKey.classId}, ${advisoryKey.objectId});
          commit;
        `);
        await waitForAdvisoryLockWaiter(advisoryKey);

        const publisher = psql(`
          set application_name = '${publisherApplicationName}';
          set request.jwt.claim.sub = '${ownerId}';
          select outcome from public.publish_rubric_version('${organizationId}', '${rubricId}', 1);
        `);
        await waitForPublisherBlocked(publisherApplicationName, mutatorApplicationName);
        await releaseAdvisoryLockHolder(lockHolderPid, advisoryKey);
        await waitForExit(lockHolder);
        lockHolder = undefined;
        lockHolderPid = undefined;

        const [, publication] = await Promise.all([mutator, publisher]);
        const { stdout: status } = await psql(
          `select status from public.rubric_versions where id = '${versionId}'`,
        );
        expect(status.trim()).toBe('draft');
        expect(publication.stdout).toContain('invalid_draft');
      } finally {
        if (lockHolder) {
          const exactHolderPid =
            lockHolderPid ?? (await findAdvisoryLockHolderPid(advisoryKey, holderApplicationName));
          if (exactHolderPid !== undefined) {
            await releaseAdvisoryLockHolder(exactHolderPid, advisoryKey);
          } else {
            lockHolder.kill();
          }
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
