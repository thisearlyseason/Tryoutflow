import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
const wait = (fn: () => Promise<boolean>) =>
  new Promise<void>(async (resolve, reject) => {
    const end = Date.now() + 5_000;
    while (Date.now() < end) {
      if (await fn()) return resolve();
      await new Promise((r) => setTimeout(r, 15));
    }
    reject(new Error('bounded lock handshake timed out'));
  });
const waitForExit = async (process: ChildProcess | undefined) => {
  if (!process || process.exitCode !== null) return;
  await new Promise<void>((resolve) => process.once('exit', () => resolve()));
};

describe('tryout publication configuration locking', () => {
  it.each([
    'tryout_positions',
    'session_groups',
    'tryout_divisions',
    'tryout_sessions',
    'registration_form_versions',
    'rubric_categories',
    'session_rubrics',
  ] as const)('observes publisher blocked by a %s mutator and serializes safely', async (kind) => {
    const org = randomUUID(),
      owner = randomUUID(),
      tryout = randomUUID(),
      division = randomUUID(),
      session = randomUUID(),
      form = randomUUID(),
      formVersion = randomUUID(),
      rubric = randomUUID(),
      rubricVersion = randomUUID(),
      position = randomUUID(),
      group = randomUUID(),
      app = `tf-${randomUUID()}`;
    const mutation: Record<typeof kind, string> = {
      tryout_positions: `update public.tryout_positions set name='Wing' where id='${position}'`,
      session_groups: `update public.session_groups set name='Blue' where id='${group}'`,
      tryout_divisions: `update public.tryout_divisions set name='U16' where id='${division}'`,
      tryout_sessions: `update public.tryout_sessions set name='Late session' where id='${session}'`,
      registration_form_versions: `update public.registration_form_versions set schema='{"fields":[]}' where id='${formVersion}'`,
      rubric_categories: `update public.rubric_categories set name='Overall score' where rubric_version_id='${rubricVersion}'`,
      session_rubrics: `update public.session_rubrics set rubric_version_id='${rubricVersion}' where session_id='${session}'`,
    };
    let mutator: ChildProcess | undefined;
    let holder: ChildProcess | undefined;
    try {
      await psql(
        `insert into auth.users(id) values('${owner}'); insert into public.organizations(id,name,slug,timezone) values('${org}','C','c-${org.slice(0, 8)}','America/Edmonton'); insert into public.organization_members(organization_id,user_id,role) values('${org}','${owner}','owner'); insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at) values('${tryout}','${org}','Camp','camp-${tryout.slice(0, 8)}','Hockey','America/Edmonton',now()-interval '1 hour',now()+interval '1 day'); insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${division}','${org}','${tryout}','U15',0); insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at) values('${session}','${org}','${tryout}','${division}','S',now()+interval '2 days',now()+interval '3 days'); insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values('${group}','${org}','${tryout}','${session}','A',0); insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order) values('${position}','${org}','${tryout}','Center',0); insert into public.registration_forms(id,organization_id,tryout_id,name) values('${form}','${org}','${tryout}','F'); insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema) values('${formVersion}','${org}','${tryout}','${form}',1,'{"fields":[]}'); insert into public.rubrics(id,organization_id,tryout_id,name) values('${rubric}','${org}','${tryout}','R'); insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number) values('${rubricVersion}','${org}','${tryout}','${rubric}',1); insert into public.rubric_categories(organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max) values('${org}','${tryout}','${rubricVersion}','Overall',0,100,1,5); insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) values('${org}','${tryout}','${session}','${rubricVersion}'); set request.jwt.claim.sub='${owner}'; select * from public.select_tryout_registration_form_version('${org}','${tryout}','${formVersion}');`,
      );
      holder = spawn(
        'psql',
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-At',
          databaseUrl,
          '-c',
          `set application_name='${app}-holder'; select pg_advisory_lock(42, 42); select pg_sleep(30);`,
        ],
        { stdio: 'ignore' },
      );
      await wait(
        async () =>
          (
            await psql(
              `select exists(select 1 from pg_stat_activity where application_name='${app}-holder')`,
            )
          ).stdout.trim() === 't',
      );
      mutator = spawn(
        'psql',
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-At',
          databaseUrl,
          '-c',
          `set application_name='${app}-mutator'; begin; ${mutation[kind]}; select pg_advisory_lock(42, 42); commit;`,
        ],
        { stdio: 'ignore' },
      );
      await wait(
        async () =>
          (
            await psql(
              `select exists(select 1 from pg_stat_activity where application_name='${app}-mutator' and state='active')`,
            )
          ).stdout.trim() === 't',
      );
      const publisher = psql(
        `set application_name='${app}-publisher'; set request.jwt.claim.sub='${owner}'; select outcome from public.publish_tryout('${org}','${tryout}',0);`,
      );
      await wait(
        async () =>
          (
            await psql(
              `select exists(select 1 from pg_stat_activity p join pg_stat_activity m on m.application_name='${app}-mutator' where p.application_name='${app}-publisher' and p.wait_event_type='Lock' and m.pid=any(pg_blocking_pids(p.pid)))`,
            )
          ).stdout.trim() === 't',
      );
      await psql(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name='${app}-holder'`,
      );
      const result = await publisher;
      await waitForExit(mutator);
      await waitForExit(holder);
      expect(result.stdout.trim()).toMatch(/published|conflict|rubric_invalid/);
    } finally {
      if (mutator && mutator.exitCode === null) mutator.kill();
      if (holder && holder.exitCode === null) holder.kill();
      await waitForExit(mutator);
      await waitForExit(holder);
      // The temporary tenant has append-only audit and configuration root-lock
      // guards. Delete each explicitly-scoped row while triggers are disabled
      // instead of relying on an organization cascade (whose child deletes
      // intentionally acquire a tryout root that has already been removed).
      // This avoids leaking rows into the canonical pgTAP database.
      await psql(
        `set session_replication_role=replica; delete from public.audit_logs where organization_id='${org}'; delete from public.tryout_publications where organization_id='${org}'; delete from public.tryout_setup_progress where organization_id='${org}'; delete from public.tryout_registration_form_selections where organization_id='${org}'; delete from public.session_rubrics where organization_id='${org}'; delete from public.rubric_categories where organization_id='${org}'; delete from public.rubric_versions where organization_id='${org}'; delete from public.rubrics where organization_id='${org}'; delete from public.registration_form_versions where organization_id='${org}'; delete from public.registration_forms where organization_id='${org}'; delete from public.session_groups where organization_id='${org}'; delete from public.tryout_sessions where organization_id='${org}'; delete from public.tryout_positions where organization_id='${org}'; delete from public.tryout_divisions where organization_id='${org}'; delete from public.tryout_staff_assignments where organization_id='${org}'; delete from public.tryouts where organization_id='${org}'; delete from public.organization_members where organization_id='${org}'; delete from public.organizations where id='${org}'; delete from auth.users where id='${owner}'; set session_replication_role=origin;`,
      );
    }
  });
});
