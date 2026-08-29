// @vitest-environment node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string, applicationName = 'tryoutflow-checkin-integration') =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql], {
    env: { ...process.env, PGAPPNAME: applicationName },
  });

const waitForOutput = (child: ReturnType<typeof spawn>, expected: string) =>
  new Promise<void>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(expected)) {
        child.stdout?.off('data', onStdout);
        resolve();
      }
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', (code) => {
      if (!stdout.includes(expected)) reject(new Error(`psql exited ${code}: ${stderr}`));
    });
  });

const waitForBlockedCalls = async (applicationNames: string[]) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await psql(
      `select count(*) from pg_stat_activity where application_name=any(array[${applicationNames.map((name) => `'${name}'`).join(',')}]) and wait_event_type='Lock'`,
    );
    if (Number(result.stdout.trim()) === applicationNames.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`calls did not block on enrollment move: ${applicationNames.join(', ')}`);
};

describe('concurrent number assignment and check-in', () => {
  it.each([
    ['anon', 'audit_logs'],
    ['authenticated', 'audit_logs'],
    ['service_role', 'audit_logs'],
    ['anon', 'platform_support_elevations'],
    ['authenticated', 'platform_support_elevations'],
    ['service_role', 'platform_support_elevations'],
  ])('denies %s runtime TRUNCATE on %s', async (role, table) => {
    await expect(
      psql(`begin; set local role ${role}; truncate table public.${table}; rollback;`),
    ).rejects.toMatchObject({ stderr: expect.stringMatching(/permission denied/u) });
  });

  it('allows one requested number claimant, permits the same session number in another session, and deduplicates check-in', async () => {
    const id = () => randomUUID();
    const ownerId = id();
    const staffId = id();
    const scopedStaffId = id();
    const groupScopedStaffId = id();
    const organizationId = id();
    const tryoutId = id();
    const divisionId = id();
    const divisionTwoId = id();
    const sessionOneId = id();
    const sessionTwoId = id();
    const correctionSessionId = id();
    const divisionTwoSessionId = id();
    const groupId = id();
    const siblingGroupId = id();
    const formId = id();
    const versionId = id();
    const athleteIds = [id(), id(), id(), id(), id()];
    const registrationIds = [id(), id(), id(), id(), id()];
    const slug = `checkin-${tryoutId.slice(0, 8)}`;
    const callAs = (actorId: string, sql: string, column = 'outcome', applicationName?: string) =>
      psql(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${actorId}',true); create temporary table rpc_result on commit preserve rows as ${sql}; commit; select ${column} from rpc_result;`,
        applicationName,
      );
    const call = (sql: string, column = 'outcome') => callAs(staffId, sql, column);
    try {
      await psql(`
        insert into auth.users(id) values('${ownerId}'),('${staffId}'),('${scopedStaffId}'),('${groupScopedStaffId}');
        insert into public.organizations(id,name,slug,timezone) values('${organizationId}','Concurrent Checkin','${slug}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organizationId}','${ownerId}','owner','active'),('${organizationId}','${staffId}','member','active'),
          ('${organizationId}','${scopedStaffId}','member','active'),
          ('${organizationId}','${groupScopedStaffId}','member','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${tryoutId}','${organizationId}','Concurrent Camp','${slug}','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
          ('${divisionId}','${organizationId}','${tryoutId}','U13',0),
          ('${divisionTwoId}','${organizationId}','${tryoutId}','U15',1);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,capacity,starts_at,ends_at,sort_order) values
          ('${sessionOneId}','${organizationId}','${tryoutId}','${divisionId}','One',null,clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
          ('${sessionTwoId}','${organizationId}','${tryoutId}','${divisionId}','Two',1,clock_timestamp()+interval '1 day 2 hours',clock_timestamp()+interval '1 day 3 hours',1),
          ('${correctionSessionId}','${organizationId}','${tryoutId}','${divisionId}','Correction',null,clock_timestamp()+interval '1 day 4 hours',clock_timestamp()+interval '1 day 5 hours',2),
          ('${divisionTwoSessionId}','${organizationId}','${tryoutId}','${divisionTwoId}','Other division',null,clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
        insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order,capacity) values
          ('${groupId}','${organizationId}','${tryoutId}','${sessionOneId}','Last slot',0,1),
          ('${siblingGroupId}','${organizationId}','${tryoutId}','${sessionOneId}','Sibling group',1,null);
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${formId}','${organizationId}','${tryoutId}','Form');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
          values('${versionId}','${organizationId}','${tryoutId}','${formId}',1,'{"fields":[]}','published',clock_timestamp());
        insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
          ('${athleteIds[0]}','${organizationId}','Ava','One','ava','one','2013-01-01'),
          ('${athleteIds[1]}','${organizationId}','Mia','Two','mia','two','2013-01-02'),
          ('${athleteIds[2]}','${organizationId}','Noa','Three','noa','three','2013-01-03'),
          ('${athleteIds[3]}','${organizationId}','Ivy','Four','ivy','four','2013-01-04'),
          ('${athleteIds[4]}','${organizationId}','Leo','Five','leo','five','2013-01-05');
        insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
          ('${registrationIds[0]}','${organizationId}','${tryoutId}','${athleteIds[0]}','${divisionId}','${versionId}','{}',repeat('a',64),repeat('1',64)),
          ('${registrationIds[1]}','${organizationId}','${tryoutId}','${athleteIds[1]}','${divisionId}','${versionId}','{}',repeat('b',64),repeat('2',64)),
          ('${registrationIds[2]}','${organizationId}','${tryoutId}','${athleteIds[2]}','${divisionId}','${versionId}','{}',repeat('c',64),repeat('3',64)),
          ('${registrationIds[3]}','${organizationId}','${tryoutId}','${athleteIds[3]}','${divisionId}','${versionId}','{}',repeat('d',64),repeat('4',64)),
          ('${registrationIds[4]}','${organizationId}','${tryoutId}','${athleteIds[4]}','${divisionTwoId}','${versionId}','{}',repeat('e',64),repeat('5',64));
        insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values
          ('${organizationId}','${tryoutId}','${registrationIds[2]}','${sessionOneId}'),
          ('${organizationId}','${tryoutId}','${registrationIds[3]}','${sessionOneId}');
        insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,group_id,granted_by_user_id) values
          ('${organizationId}','${staffId}','checkin','tryout','${tryoutId}',null,null,'${ownerId}'),
          ('${organizationId}','${scopedStaffId}','checkin','session','${tryoutId}','${sessionOneId}',null,'${ownerId}'),
          ('${organizationId}','${groupScopedStaffId}','checkin','group','${tryoutId}','${sessionOneId}','${groupId}','${ownerId}');
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

      const globalAssignments = await Promise.all([
        call(
          `select assigned_number from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[0]}','${divisionId}',null,null,'tryout',null)`,
          'assigned_number',
        ),
        call(
          `select assigned_number from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[4]}','${divisionTwoId}',null,null,'tryout',null)`,
          'assigned_number',
        ),
      ]);
      expect(globalAssignments.map(({ stdout }) => Number(stdout.trim())).sort()).toEqual([1, 2]);
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

      const mover = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl], {
        env: { ...process.env, PGAPPNAME: 'checkin-enrollment-mover' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const moveLocked = waitForOutput(mover, 'enrollment-move-locked');
      mover.stdin?.write(
        `begin; update public.session_enrollments set session_id='${sessionTwoId}' where organization_id='${organizationId}' and registration_id='${registrationIds[2]}' and session_id='${sessionOneId}'; select 'enrollment-move-locked';\n`,
      );
      await moveLocked;
      const moveRaceNames = [
        'checkin-move-race-assign',
        'checkin-move-race-release',
        'checkin-move-race-checkin',
      ];
      const moveRace = [
        callAs(
          scopedStaffId,
          `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[2]}','${divisionId}','${sessionOneId}',null,'session',8)`,
          'outcome',
          moveRaceNames[0],
        ),
        callAs(
          scopedStaffId,
          `select public.release_tryout_number('${organizationId}','${tryoutId}','${registrationIds[2]}','${sessionOneId}',null,'placement_changed') as outcome`,
          'outcome',
          moveRaceNames[1],
        ),
        callAs(
          scopedStaffId,
          `select outcome from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[2]}','${sessionOneId}',null,'concurrent-move-request-0001','session',8)`,
          'outcome',
          moveRaceNames[2],
        ),
      ];
      await waitForBlockedCalls(moveRaceNames);
      const moverExited = new Promise<void>((resolve, reject) => {
        mover.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`enrollment mover exited ${code}`)),
        );
      });
      mover.stdin?.end('commit;\n');
      await moverExited;
      expect((await Promise.all(moveRace)).map(({ stdout }) => stdout.trim())).toEqual([
        'forbidden',
        'forbidden',
        'forbidden',
      ]);
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where registration_id='${registrationIds[2]}' and session_id='${sessionOneId}' and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('0');
      await psql(
        `update public.session_enrollments set session_id='${sessionOneId}' where organization_id='${organizationId}' and registration_id='${registrationIds[2]}' and session_id='${sessionTwoId}'`,
      );

      const placer = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl], {
        env: { ...process.env, PGAPPNAME: 'checkin-unplaced-placer' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const placementLocked = waitForOutput(placer, 'unplaced-placement-locked');
      placer.stdin?.write(
        `begin; insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id) values('${organizationId}','${tryoutId}','${registrationIds[1]}','${sessionOneId}','${siblingGroupId}'); select 'unplaced-placement-locked';\n`,
      );
      await placementLocked;
      const unplacedRaceNames = ['checkin-unplaced-race-assign', 'checkin-unplaced-race-checkin'];
      const unplacedRace = [
        callAs(
          groupScopedStaffId,
          `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[1]}','${divisionId}','${sessionOneId}','${groupId}','group',18)`,
          'outcome',
          unplacedRaceNames[0],
        ),
        callAs(
          groupScopedStaffId,
          `select outcome from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[1]}','${sessionOneId}','${groupId}','concurrent-unplaced-request-1','group',18)`,
          'outcome',
          unplacedRaceNames[1],
        ),
      ];
      await waitForBlockedCalls(unplacedRaceNames);
      const placerExited = new Promise<void>((resolve, reject) => {
        placer.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`unplaced placer exited ${code}`)),
        );
      });
      placer.stdin?.end('commit;\n');
      await placerExited;
      expect((await Promise.all(unplacedRace)).map(({ stdout }) => stdout.trim())).toEqual([
        'forbidden',
        'forbidden',
      ]);
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where registration_id='${registrationIds[1]}' and group_id='${groupId}' and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('0');
      await psql(
        `delete from public.session_enrollments where organization_id='${organizationId}' and registration_id='${registrationIds[1]}' and session_id='${sessionOneId}'`,
      );

      expect(
        (
          await callAs(
            scopedStaffId,
            `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[4]}','${divisionId}','${sessionOneId}',null,'session',88)`,
          )
        ).stdout.trim(),
      ).toBe('invalid_registration');
      expect(
        (
          await call(
            `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[4]}','${divisionTwoId}','${divisionTwoSessionId}',null,'session',77)`,
          )
        ).stdout.trim(),
      ).toBe('assigned');
      expect(
        (
          await callAs(
            scopedStaffId,
            `select public.release_tryout_number('${organizationId}','${tryoutId}','${registrationIds[4]}','${sessionOneId}',null,'offboarding') as outcome`,
          )
        ).stdout.trim(),
      ).toBe('invalid_placement');
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where registration_id='${registrationIds[4]}' and session_id='${divisionTwoSessionId}' and number=77 and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');

      const initialReceipt = (
        await call(
          `select * from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[0]}','${correctionSessionId}',null,'immutable-receipt-request-0001','session',50)`,
          `outcome||'|'||receipt_id||'|'||checked_in_at||'|'||assigned_number`,
        )
      ).stdout.trim();
      expect(initialReceipt).toMatch(/^checked_in\|[0-9a-f-]+\|.+\|50$/u);
      expect(
        (
          await call(
            `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[0]}','${divisionId}','${correctionSessionId}',null,'session',51)`,
          )
        ).stdout.trim(),
      ).toBe('corrected');
      expect(
        (
          await psql(
            `select count(*) filter(where number=50 and released_at is not null)||'|'||count(*) filter(where number=51 and released_at is null) from public.tryout_numbers where registration_id='${registrationIds[0]}' and session_id='${correctionSessionId}'`,
          )
        ).stdout.trim(),
      ).toBe('1|1');
      expect(
        (
          await call(
            `select * from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[0]}','${correctionSessionId}',null,'immutable-receipt-request-0001','session',50)`,
            `outcome||'|'||receipt_id||'|'||checked_in_at||'|'||assigned_number`,
          )
        ).stdout.trim(),
      ).toBe(initialReceipt);
      expect(
        (
          await call(
            `select * from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[0]}','${correctionSessionId}',null,'deliberate-repeat-request-001','session',50)`,
            `outcome||'|'||receipt_id||'|'||assigned_number`,
          )
        ).stdout.trim(),
      ).toMatch(/^already_checked_in\|[0-9a-f-]+\|50$/u);
      expect(
        (
          await psql(
            `select count(*) from public.audit_logs where organization_id='${organizationId}' and action='checkin.number_released' and details->>'reason'='correction' and details->'scope'->>'sessionId'='${correctionSessionId}'`,
          )
        ).stdout.trim(),
      ).toBe('1');

      const issuedTokens = await Promise.all([
        callAs(
          ownerId,
          `select public.issue_checkin_qr_token('${organizationId}','${tryoutId}','${registrationIds[4]}') as token`,
          'token',
        ),
        callAs(
          ownerId,
          `select public.issue_checkin_qr_token('${organizationId}','${tryoutId}','${registrationIds[4]}') as token`,
          'token',
        ),
      ]);
      const rawTokens = issuedTokens.map(({ stdout }) => stdout.trim());
      expect(rawTokens.every((token) => /^[0-9a-f]{64}$/u.test(token))).toBe(true);
      expect(
        (
          await psql(
            `select count(*) from public.checkin_qr_tokens where organization_id='${organizationId}' and registration_id='${registrationIds[4]}' and used_at is null and revoked_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');
      expect(
        (
          await psql(
            `select count(*) from public.checkin_qr_tokens where organization_id='${organizationId}' and registration_id='${registrationIds[4]}' and used_at is null and revoked_at is null and token_digest in(encode(extensions.digest('${rawTokens[0]}','sha256'),'hex'),encode(extensions.digest('${rawTokens[1]}','sha256'),'hex'))`,
          )
        ).stdout.trim(),
      ).toBe('1');
      expect(
        (
          await psql(
            `select count(*) from public.audit_logs where organization_id='${organizationId}' and actor_user_id='${ownerId}' and action='checkin.qr_issued' and entity_id='${registrationIds[4]}'`,
          )
        ).stdout.trim(),
      ).toBe('2');

      const lastGroupSlot = await Promise.all([
        call(
          `select outcome from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[2]}','${sessionOneId}','${groupId}','concurrent-group-request-000001','group',null)`,
        ),
        call(
          `select outcome from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[3]}','${sessionOneId}','${groupId}','concurrent-group-request-000002','group',null)`,
        ),
      ]);
      expect(lastGroupSlot.map(({ stdout }) => stdout.trim()).sort()).toEqual([
        'capacity',
        'checked_in',
      ]);
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where organization_id='${organizationId}' and scope_kind='group' and group_id='${groupId}' and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');

      const lastSlot = await Promise.all([
        call(
          `select outcome from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[0]}','${sessionTwoId}',null,'concurrent-capacity-request-00001','session',null)`,
        ),
        call(
          `select outcome from public.check_in_registration_v2('${organizationId}','${tryoutId}','${registrationIds[1]}','${sessionTwoId}',null,'concurrent-capacity-request-00002','session',null)`,
        ),
      ]);
      expect(lastSlot.map(({ stdout }) => stdout.trim()).sort()).toEqual([
        'capacity',
        'checked_in',
      ]);
      expect(
        (
          await psql(
            `select count(*) from public.checkins where organization_id='${organizationId}' and session_id='${sessionTwoId}' and reversed_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where organization_id='${organizationId}' and scope_kind='session' and session_id='${sessionTwoId}' and registration_id in('${registrationIds[0]}','${registrationIds[1]}') and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');
      await psql(
        `delete from public.session_enrollments where organization_id='${organizationId}' and session_id='${sessionTwoId}' and registration_id in('${registrationIds[0]}','${registrationIds[1]}')`,
      );
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where organization_id='${organizationId}' and scope_kind='session' and session_id='${sessionTwoId}' and registration_id in('${registrationIds[0]}','${registrationIds[1]}') and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('0');
      expect(
        (
          await psql(
            `select count(*) from public.audit_logs where organization_id='${organizationId}' and actor_user_id is null and action='checkin.number_released' and details->>'reason'='placement_changed' and details->'scope'->>'sessionId'='${sessionTwoId}'`,
          )
        ).stdout.trim(),
      ).toBe('1');

      expect(['assigned', 'corrected']).toContain(
        (
          await call(
            `select outcome from public.assign_tryout_number('${organizationId}','${tryoutId}','${registrationIds[1]}','${divisionId}','${sessionOneId}',null,'division',90)`,
          )
        ).stdout.trim(),
      );
      expect(
        (
          await call(
            `select public.release_tryout_number('${organizationId}','${tryoutId}','${registrationIds[1]}','${sessionOneId}',null,'offboarding') as outcome`,
          )
        ).stdout.trim(),
      ).toBe('released');
      expect(
        (
          await psql(
            `select count(*) from public.audit_logs where organization_id='${organizationId}' and actor_user_id='${staffId}' and action='checkin.number_released' and details->>'reason'='offboarding' and details->>'registrationId'='${registrationIds[1]}' and details->'before'->>'releasedAt' is null and details->'after'->>'releasedAt' is not null`,
          )
        ).stdout.trim(),
      ).toBe('1');

      await psql(
        `update public.tryout_registrations set status='withdrawn' where id='${registrationIds[4]}'`,
      );
      expect(
        (
          await psql(
            `select count(*) from public.audit_logs where organization_id='${organizationId}' and actor_user_id is null and action='checkin.number_released' and details->>'reason'='withdrawal' and details->>'registrationId'='${registrationIds[4]}'`,
          )
        ).stdout.trim(),
      ).toBe('2');
      expect(
        (
          await psql(
            `select count(*) from public.tryout_numbers where registration_id='${registrationIds[4]}' and released_at is null`,
          )
        ).stdout.trim(),
      ).toBe('0');
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
        delete from public.session_groups where organization_id='${organizationId}';
        delete from public.tryout_sessions where organization_id='${organizationId}';
        delete from public.tryout_divisions where organization_id='${organizationId}';
        delete from public.tryouts where organization_id='${organizationId}';
        delete from public.organization_members where organization_id='${organizationId}';
        delete from public.organizations where id='${organizationId}';
        delete from auth.users where id in('${ownerId}','${staffId}','${scopedStaffId}','${groupScopedStaffId}');
        set session_replication_role=origin;
      `);
    }
  });
});
