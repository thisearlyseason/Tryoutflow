// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string, applicationName = 'tryoutflow-evaluation-integration') =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql], {
    env: { ...process.env, PGAPPNAME: applicationName },
  });

const asAuthenticated = (userId: string, sql: string, applicationName: string) =>
  psql(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false); ${sql}`,
    applicationName,
  );

describe('evaluation independence and compare-and-swap serialization', () => {
  it('keeps one natural record and gives exactly one winner for concurrent saves, completion, and reopen', async () => {
    const owner = randomUUID();
    const director = randomUUID();
    const evaluator = randomUUID();
    const organization = randomUUID();
    const tryout = randomUUID();
    const division = randomUUID();
    const session = randomUUID();
    const form = randomUUID();
    const formVersion = randomUUID();
    const athlete = randomUUID();
    const registration = randomUUID();
    const rubric = randomUUID();
    const rubricVersion = randomUUID();
    const category = randomUUID();
    const suffix = organization.slice(0, 8);

    try {
      await psql(`
        insert into auth.users(id) values('${owner}'),('${director}'),('${evaluator}');
        insert into public.organizations(id,name,slug) values('${organization}','Concurrent Evaluation','eval-${suffix}');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organization}','${owner}','owner','active'),('${organization}','${director}','member','active'),('${organization}','${evaluator}','member','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
          values('${tryout}','${organization}','Camp','camp-${suffix}','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
          values('${division}','${organization}','${tryout}','Open',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order)
          values('${session}','${organization}','${tryout}','${division}','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
        insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,granted_by_user_id) values
          ('${organization}','${director}','director','session','${tryout}','${session}','${owner}'),
          ('${organization}','${evaluator}','evaluator','session','${tryout}','${session}','${owner}');
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${form}','${organization}','${tryout}','Form');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
          values('${formVersion}','${organization}','${tryout}','${form}',1,'{"fields":[]}','published',clock_timestamp());
        insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
          values('${athlete}','${organization}','Concurrency','Athlete','concurrency','athlete','2012-01-01');
        insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest)
          values('${registration}','${organization}','${tryout}','${athlete}','${division}','${formVersion}','{}',repeat('a',64),repeat('b',64));
        insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id)
          values('${organization}','${tryout}','${registration}','${session}');
        insert into public.rubrics(id,organization_id,tryout_id,name) values('${rubric}','${organization}','${tryout}','Skills');
        insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number)
          values('${rubricVersion}','${organization}','${tryout}','${rubric}',1);
        insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max)
          values('${category}','${organization}','${tryout}','${rubricVersion}','Skill',0,100,1,5);
        insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id)
          values('${organization}','${tryout}','${session}','${rubricVersion}');
        set session_replication_role=replica;
        update public.rubric_versions set status='published',published_at=clock_timestamp() where id='${rubricVersion}';
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryout}';
        set session_replication_role=origin;
      `);

      const draftCall = (expectedVersion: number, value: number, name: string) =>
        asAuthenticated(
          evaluator,
          `select outcome||'|'||coalesce(version::text,'') from public.save_evaluation_draft('${organization}','${tryout}','${division}','${registration}','${session}',null,'${rubricVersion}',${expectedVersion},'[{"categoryId":"${category}","value":${value}}]',null,array[]::uuid[],array[]::text[])`,
          name,
        );

      const createResults = await Promise.all([
        draftCall(0, 3, `evaluation-create-a-${suffix}`),
        draftCall(0, 4, `evaluation-create-b-${suffix}`),
      ]);
      expect(createResults.map((result) => result.stdout).join('\n')).toContain('saved|1');
      expect(createResults.map((result) => result.stdout).join('\n')).toContain('conflict|1');
      expect(
        (
          await psql(
            `select count(*) from public.evaluations where organization_id='${organization}'`,
          )
        ).stdout,
      ).toBe('1\n');

      const saveResults = await Promise.all([
        draftCall(1, 4, `evaluation-save-a-${suffix}`),
        draftCall(1, 5, `evaluation-save-b-${suffix}`),
      ]);
      expect(saveResults.map((result) => result.stdout).join('\n')).toContain('saved|2');
      expect(saveResults.map((result) => result.stdout).join('\n')).toContain('conflict|2');
      const evaluationId = (
        await psql(`select id from public.evaluations where organization_id='${organization}'`)
      ).stdout.trim();

      const completeResults = await Promise.all([
        asAuthenticated(
          evaluator,
          `select outcome||'|'||version from public.complete_evaluation('${organization}','${tryout}','${division}','${session}',null,'${evaluationId}',2)`,
          `evaluation-complete-a-${suffix}`,
        ),
        asAuthenticated(
          evaluator,
          `select outcome||'|'||version from public.complete_evaluation('${organization}','${tryout}','${division}','${session}',null,'${evaluationId}',2)`,
          `evaluation-complete-b-${suffix}`,
        ),
      ]);
      expect(completeResults.map((result) => result.stdout).join('\n')).toContain('completed|3');
      expect(completeResults.map((result) => result.stdout).join('\n')).toContain('conflict|3');

      const lockResults = await Promise.all([
        asAuthenticated(
          director,
          `select outcome||'|'||version from public.lock_evaluation('${organization}','${tryout}','${division}','${session}',null,'${evaluationId}',3)`,
          `evaluation-lock-a-${suffix}`,
        ),
        asAuthenticated(
          director,
          `select outcome||'|'||version from public.lock_evaluation('${organization}','${tryout}','${division}','${session}',null,'${evaluationId}',3)`,
          `evaluation-lock-b-${suffix}`,
        ),
      ]);
      expect(lockResults.map((result) => result.stdout).join('\n')).toContain('locked|4');
      expect(lockResults.map((result) => result.stdout).join('\n')).toContain('conflict|4');

      const reopenResults = await Promise.all([
        asAuthenticated(
          director,
          `select outcome||'|'||version from public.reopen_evaluation('${organization}','${tryout}','${division}','${session}',null,'${evaluationId}',4,'Concurrent director review A')`,
          `evaluation-reopen-a-${suffix}`,
        ),
        asAuthenticated(
          director,
          `select outcome||'|'||version from public.reopen_evaluation('${organization}','${tryout}','${division}','${session}',null,'${evaluationId}',4,'Concurrent director review B')`,
          `evaluation-reopen-b-${suffix}`,
        ),
      ]);
      expect(reopenResults.map((result) => result.stdout).join('\n')).toContain('reopened|5');
      expect(reopenResults.map((result) => result.stdout).join('\n')).toContain('conflict|5');
      expect(
        (
          await psql(
            `select state||'|'||version||'|'||(select count(*) from public.audit_logs where action='evaluation.reopened' and entity_id='${evaluationId}') from public.evaluations where id='${evaluationId}'`,
          )
        ).stdout.trim(),
      ).toBe('reopened|5|1');

      const directorFlagCall = (flagId: string | null, action: 'upsert' | 'revoke', name: string) =>
        asAuthenticated(
          director,
          `select outcome||'|'||coalesce(athlete_flag_id::text,'') from public.manage_director_evaluation_flag('${organization}','${tryout}','${division}','${registration}','${session}',null,${flagId ? `'${flagId}'` : 'null'},'${action}','needs_another_look')`,
          name,
        );
      const createFlagResults = await Promise.all([
        directorFlagCall(null, 'upsert', `director-flag-create-a-${suffix}`),
        directorFlagCall(null, 'upsert', `director-flag-create-b-${suffix}`),
      ]);
      expect(createFlagResults.map((result) => result.stdout).join('\n')).toContain('saved|');
      expect(createFlagResults.map((result) => result.stdout).join('\n')).toContain('conflict|');
      const directorFlagId = (
        await psql(
          `select id from public.athlete_flags where organization_id='${organization}' and creator_kind='director'`,
        )
      ).stdout.trim();
      const revokeFlagResults = await Promise.all([
        directorFlagCall(directorFlagId, 'revoke', `director-flag-revoke-a-${suffix}`),
        directorFlagCall(directorFlagId, 'revoke', `director-flag-revoke-b-${suffix}`),
      ]);
      expect(revokeFlagResults.map((result) => result.stdout).join('\n')).toContain('revoked|');
      expect(revokeFlagResults.map((result) => result.stdout).join('\n')).toContain(
        'invalid_flag|',
      );
      expect(
        (
          await psql(
            `select (revoked_at is not null)::text||'|'||(select count(*) from public.audit_logs where entity_id='${directorFlagId}' and action in ('evaluation.director_flag_saved','evaluation.director_flag_revoked')) from public.athlete_flags where id='${directorFlagId}'`,
          )
        ).stdout.trim(),
      ).toBe('true|2');
    } finally {
      await psql(`
        set session_replication_role=replica;
        do $cleanup$
        declare target record;
        begin
          for target in
            select distinct table_name from information_schema.columns
            where table_schema='public' and column_name='organization_id' and table_name<>'organizations'
          loop
            execute format('delete from public.%I where organization_id=$1',target.table_name) using '${organization}'::uuid;
          end loop;
        end $cleanup$;
        delete from public.organizations where id='${organization}';
        delete from auth.users where id in ('${owner}','${director}','${evaluator}');
        set session_replication_role=origin;
      `).catch(() => undefined);
    }
  });
});
