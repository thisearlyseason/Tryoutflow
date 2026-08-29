// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { parseRankingSnapshot } from '../../../src/modules/rankings/infrastructure/supabase-ranking-gateway';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
const owner = 'f1111111-1111-4111-8111-111111111111';
const director = 'f1222222-2222-4222-8222-222222222222';
const reviewer = 'f1333333-3333-4333-8333-333333333333';
const evaluatorA = 'f1444444-4444-4444-8444-444444444444';
const evaluatorB = 'f1555555-5555-4555-8555-555555555555';
const checkin = 'f1666666-6666-4666-8666-666666666666';
const member = 'f1777777-7777-4777-8777-777777777777';
const organization = 'f1000000-0000-4000-8000-000000000001';
const otherOrganization = 'f1000000-0000-4000-8000-000000000002';
const tryout = 'f1888888-8888-4888-8888-888888888888';
const division = 'f1999999-9999-4999-8999-999999999999';
const session = 'f1aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const group = 'f1bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const position = 'f1cccccc-cccc-4ccc-8ccc-cccccccccccc';
const form = 'f1dddddd-dddd-4ddd-8ddd-dddddddddddd';
const formVersion = 'f1eeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const rubric = 'f1ffffff-ffff-4fff-8fff-ffffffffffff';
const rubricVersion = 'f2000000-0000-4000-8000-000000000001';
const category = 'f2000000-0000-4000-8000-000000000002';
const athleteA = 'f2000000-0000-4000-8000-000000000003';
const athleteB = 'f2000000-0000-4000-8000-000000000004';
const registrationA = 'f2000000-0000-4000-8000-000000000005';
const registrationB = 'f2000000-0000-4000-8000-000000000006';
const evaluationA = 'f2000000-0000-4000-8000-000000000007';
const evaluationB = 'f2000000-0000-4000-8000-000000000008';

const asUser = (userId: string, sql: string) =>
  psql(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false); ${sql}`,
  );

describe('real authorized ranking projection', () => {
  it('filters exact completed evidence, counts current assignment coverage, and denies unrelated roles', async () => {
    try {
      await psql(`
        insert into auth.users(id) values('${owner}'),('${director}'),('${reviewer}'),('${evaluatorA}'),('${evaluatorB}'),('${checkin}'),('${member}');
        insert into public.organizations(id,name,slug) values('${organization}','Ranking Org','ranking-org'),('${otherOrganization}','Other Org','other-ranking-org');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organization}','${owner}','owner','active'),('${organization}','${director}','member','active'),
          ('${organization}','${reviewer}','member','active'),('${organization}','${evaluatorA}','member','active'),
          ('${organization}','${evaluatorB}','member','active'),('${organization}','${checkin}','member','active'),
          ('${organization}','${member}','member','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${tryout}','${organization}','Ranking Camp','ranking-camp','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${division}','${organization}','${tryout}','U15',0);
        insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order) values('${position}','${organization}','${tryout}','Forward',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values('${session}','${organization}','${tryout}','${division}','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
        insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values('${group}','${organization}','${tryout}','${session}','Blue',0);
        insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,group_id,granted_by_user_id) values
          ('${organization}','${director}','director','group','${tryout}','${session}','${group}','${owner}'),
          ('${organization}','${reviewer}','reviewer','group','${tryout}','${session}','${group}','${owner}');
        insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id) values
          ('${organization}','${evaluatorA}','evaluator','tryout','${tryout}','${owner}'),
          ('${organization}','${evaluatorB}','evaluator','tryout','${tryout}','${owner}'),
          ('${organization}','${checkin}','checkin','tryout','${tryout}','${owner}');
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${form}','${organization}','${tryout}','Form');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values('${formVersion}','${organization}','${tryout}','${form}',1,'{"fields":[]}','published',clock_timestamp());
        insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
          ('${athleteA}','${organization}','Alex','Athlete','alex','athlete','2012-01-01'),
          ('${athleteB}','${organization}','Blair','Athlete','blair','athlete','2012-02-01');
        insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,position_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
          ('${registrationA}','${organization}','${tryout}','${athleteA}','${division}','${position}','${formVersion}','{}',repeat('a',64),repeat('1',64)),
          ('${registrationB}','${organization}','${tryout}','${athleteB}','${division}','${position}','${formVersion}','{}',repeat('b',64),repeat('2',64));
        insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id) values
          ('${organization}','${tryout}','${registrationA}','${session}','${group}'),('${organization}','${tryout}','${registrationB}','${session}','${group}');
        insert into public.rubrics(id,organization_id,tryout_id,name) values('${rubric}','${organization}','${tryout}','Skills');
        insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number) values('${rubricVersion}','${organization}','${tryout}','${rubric}',1);
        insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max,is_priority) values('${category}','${organization}','${tryout}','${rubricVersion}','Skating',0,100,1,5,true);
        insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) values('${organization}','${tryout}','${session}','${rubricVersion}');
        set session_replication_role=replica;
        update public.rubric_versions set status='published',published_at=clock_timestamp() where id='${rubricVersion}';
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryout}';
        insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,group_id,evaluator_user_id,rubric_version_id,state,version,completed_at) values
          ('${evaluationA}','${organization}','${tryout}','${division}','${registrationA}','${session}','${group}','${evaluatorA}','${rubricVersion}','completed',2,clock_timestamp()),
          ('${evaluationB}','${organization}','${tryout}','${division}','${registrationB}','${session}','${group}','${evaluatorB}','${rubricVersion}','locked',3,clock_timestamp());
        insert into public.evaluation_scores(organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value) values
          ('${organization}','${tryout}','${evaluationA}','${rubricVersion}','${category}',4),('${organization}','${tryout}','${evaluationB}','${rubricVersion}','${category}',4);
        insert into public.evaluation_notes(organization_id,evaluation_id,evaluator_user_id,note) values('${organization}','${evaluationA}','${evaluatorA}','private peer note');
        set session_replication_role=origin;
      `);

      const ownerResult = await asUser(
        owner,
        `select result from public.load_ranking_snapshot('${organization}','${tryout}','${division}','${position}','${session}','${group}',null)`,
      );
      const parsed = parseRankingSnapshot(JSON.parse(ownerResult.stdout.trim()));
      expect(parsed.outcome).toBe('ok');
      if (parsed.outcome !== 'ok') return;
      expect(parsed.snapshot.registrations).toHaveLength(2);
      expect(parsed.snapshot.registrations.map((row) => row.expectedEvaluators)).toEqual([2, 2]);
      expect(parsed.snapshot.registrations.map((row) => row.evaluations.length)).toEqual([1, 1]);
      expect(ownerResult.stdout).not.toContain('private peer note');
      expect(ownerResult.stdout).not.toContain(evaluatorA);

      const directorResult = await asUser(
        director,
        `select result->>'outcome' from public.load_ranking_snapshot('${organization}','${tryout}',null,null,'${session}','${group}',null)`,
      );
      expect(directorResult.stdout.trim()).toBe('ok');
      for (const denied of [evaluatorA, checkin, member]) {
        const result = await asUser(
          denied,
          `select result->>'outcome' from public.load_ranking_snapshot('${organization}','${tryout}',null,null,null,null,null)`,
        );
        expect(result.stdout.trim()).toBe('forbidden');
      }
      const publishedReviewer = await asUser(
        reviewer,
        `select result->>'outcome' from public.load_ranking_snapshot('${organization}','${tryout}',null,null,null,null,null)`,
      );
      expect(publishedReviewer.stdout.trim()).toBe('forbidden');
      await psql(
        `set session_replication_role=replica; update public.tryouts set status='finalized',finalized_at=clock_timestamp() where id='${tryout}'; set session_replication_role=origin;`,
      );
      const finalizedReviewer = await asUser(
        reviewer,
        `select result from public.load_ranking_snapshot('${organization}','${tryout}',null,null,'${session}','${group}',array['${athleteA}','${athleteB}']::uuid[])`,
      );
      expect(parseRankingSnapshot(JSON.parse(finalizedReviewer.stdout.trim())).outcome).toBe('ok');
      await psql(
        `update public.organization_members set status='disabled' where organization_id='${organization}' and user_id='${reviewer}'`,
      );
      const offboarded = await asUser(
        reviewer,
        `select result->>'outcome' from public.load_ranking_snapshot('${organization}','${tryout}',null,null,null,null,null)`,
      );
      expect(offboarded.stdout.trim()).toBe('forbidden');
      const crossTenant = await asUser(
        owner,
        `select result->>'outcome' from public.load_ranking_snapshot('${otherOrganization}','${tryout}',null,null,null,null,null)`,
      );
      expect(crossTenant.stdout.trim()).toBe('forbidden');
    } finally {
      await psql(`
        set session_replication_role=replica;
        do $cleanup$ declare target record; begin for target in select distinct table_name from information_schema.columns where table_schema='public' and column_name='organization_id' and table_name<>'organizations' loop execute format('delete from public.%I where organization_id=$1',target.table_name) using '${organization}'::uuid; end loop; end $cleanup$;
        delete from public.organizations where id in ('${organization}','${otherOrganization}');
        delete from auth.users where id in ('${owner}','${director}','${reviewer}','${evaluatorA}','${evaluatorB}','${checkin}','${member}');
        set session_replication_role=origin;
      `).catch(() => undefined);
    }
  }, 30_000);
});
