// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);

describe('concurrent number assignment and check-in', () => {
  it('allows one requested number claimant, permits the same session number in another session, and deduplicates check-in', async () => {
    const id = () => randomUUID();
    const ownerId = id();
    const staffId = id();
    const organizationId = id();
    const tryoutId = id();
    const divisionId = id();
    const sessionOneId = id();
    const sessionTwoId = id();
    const formId = id();
    const versionId = id();
    const athleteIds = [id(), id(), id(), id()];
    const registrationIds = [id(), id(), id(), id()];
    const slug = `checkin-${tryoutId.slice(0, 8)}`;
    const call = (sql: string) =>
      psql(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${staffId}',true); create temporary table rpc_result on commit preserve rows as ${sql}; commit; select outcome from rpc_result;`,
      );
    try {
      await psql(`
        insert into auth.users(id) values('${ownerId}'),('${staffId}');
        insert into public.organizations(id,name,slug,timezone) values('${organizationId}','Concurrent Checkin','${slug}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organizationId}','${ownerId}','owner','active'),('${organizationId}','${staffId}','member','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${tryoutId}','${organizationId}','Concurrent Camp','${slug}','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${divisionId}','${organizationId}','${tryoutId}','U13',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
          ('${sessionOneId}','${organizationId}','${tryoutId}','${divisionId}','One',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
          ('${sessionTwoId}','${organizationId}','${tryoutId}','${divisionId}','Two',clock_timestamp()+interval '1 day 2 hours',clock_timestamp()+interval '1 day 3 hours',1);
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${formId}','${organizationId}','${tryoutId}','Form');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
          values('${versionId}','${organizationId}','${tryoutId}','${formId}',1,'{"fields":[]}','published',clock_timestamp());
        insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
          ('${athleteIds[0]}','${organizationId}','Ava','One','ava','one','2013-01-01'),
          ('${athleteIds[1]}','${organizationId}','Mia','Two','mia','two','2013-01-02'),
          ('${athleteIds[2]}','${organizationId}','Noa','Three','noa','three','2013-01-03'),
          ('${athleteIds[3]}','${organizationId}','Ivy','Four','ivy','four','2013-01-04');
        insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
          ('${registrationIds[0]}','${organizationId}','${tryoutId}','${athleteIds[0]}','${divisionId}','${versionId}','{}',repeat('a',64),repeat('1',64)),
          ('${registrationIds[1]}','${organizationId}','${tryoutId}','${athleteIds[1]}','${divisionId}','${versionId}','{}',repeat('b',64),repeat('2',64)),
          ('${registrationIds[2]}','${organizationId}','${tryoutId}','${athleteIds[2]}','${divisionId}','${versionId}','{}',repeat('c',64),repeat('3',64)),
          ('${registrationIds[3]}','${organizationId}','${tryoutId}','${athleteIds[3]}','${divisionId}','${versionId}','{}',repeat('d',64),repeat('4',64));
        insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values
          ('${organizationId}','${tryoutId}','${registrationIds[2]}','${sessionOneId}'),
          ('${organizationId}','${tryoutId}','${registrationIds[3]}','${sessionOneId}');
        insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id)
          values('${organizationId}','${staffId}','checkin','tryout','${tryoutId}','${ownerId}');
        set session_replication_role=replica;
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryoutId}';
        set session_replication_role=origin;
      `);

      const contenders = await Promise.all([
        call(
          `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[0]}','${divisionId}',null,null,'division',42)`,
        ),
        call(
          `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[1]}','${divisionId}',null,null,'division',42)`,
        ),
      ]);
      expect(contenders.map(({ stdout }) => stdout.trim()).sort()).toEqual([
        'assigned',
        'number_conflict',
      ]);
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where organization_id='${organizationId}' and scope_kind='division' and number=42 and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');

      const sessionAssignments = await Promise.all([
        call(
          `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[2]}','${divisionId}','${sessionOneId}',null,'session',7)`,
        ),
        call(
          `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[3]}','${divisionId}','${sessionTwoId}',null,'session',7)`,
        ),
      ]);
      expect(sessionAssignments.map(({ stdout }) => stdout.trim())).toEqual([
        'assigned',
        'assigned',
      ]);

      const repeats = await Promise.all([
        call(
          `select outcome from public.check_in_registration('${organizationId}','${tryoutId}','${registrationIds[2]}','${sessionOneId}',null,'concurrent-checkin-idempotency-0001','session',7)`,
        ),
        call(
          `select outcome from public.check_in_registration('${organizationId}','${tryoutId}','${registrationIds[2]}','${sessionOneId}',null,'concurrent-checkin-idempotency-0002','session',7)`,
        ),
      ]);
      expect(repeats.map(({ stdout }) => stdout.trim()).sort()).toEqual([
        'already_checked_in',
        'checked_in',
      ]);
      expect(
        (
          await psql(
            `select count(*) from public.checkins where organization_id='${organizationId}' and registration_id='${registrationIds[2]}' and session_id='${sessionOneId}' and reversed_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');
    } finally {
      await psql(`
        set session_replication_role=replica;
        delete from public.audit_logs where organization_id='${organizationId}';
        delete from public.checkin_qr_tokens where organization_id='${organizationId}';
        delete from public.checkins where organization_id='${organizationId}';
        delete from public.tryout_numbers where organization_id='${organizationId}';
        delete from public.session_enrollments where organization_id='${organizationId}';
        delete from public.tryout_registrations where organization_id='${organizationId}';
        delete from public.athletes where organization_id='${organizationId}';
        delete from public.registration_form_versions where organization_id='${organizationId}';
        delete from public.registration_forms where organization_id='${organizationId}';
        delete from public.tryout_staff_assignments where organization_id='${organizationId}';
        delete from public.tryout_sessions where organization_id='${organizationId}';
        delete from public.tryout_divisions where organization_id='${organizationId}';
        delete from public.tryouts where organization_id='${organizationId}';
        delete from public.organization_members where organization_id='${organizationId}';
        delete from public.organizations where id='${organizationId}';
        delete from auth.users where id in('${ownerId}','${staffId}');
        set session_replication_role=origin;
      `);
    }
  });
});
