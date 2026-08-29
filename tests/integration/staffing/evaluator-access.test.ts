// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { assignEvaluator } from '../../../src/modules/staffing/application/assign-evaluator';
import { listAssignedAthletes } from '../../../src/modules/staffing/application/list-assigned-athletes';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const evaluatorId = '22222222-2222-4222-8222-222222222222' as UserId;
const directorId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = '33333333-3333-4333-8333-333333333333';
const divisionId = '44444444-4444-4444-8444-444444444444';
const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);

describe('staffing authorization boundary', () => {
  it('allows an exact-scope director to assign an evaluator but rejects a known UUID outside scope', async () => {
    const director: AuthorizationContext = {
      userId: directorId,
      organizationId,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [{ role: 'director', scope: { kind: 'division', tryoutId, divisionId } }],
    };
    const gateway = {
      assign: async () => ({ outcome: 'assigned' as const, assignmentId: 'grant' }),
    };

    await expect(
      assignEvaluator(
        {
          organizationId,
          evaluatorUserId: evaluatorId,
          tryoutId,
          scope: { kind: 'division', divisionId },
        },
        director,
        gateway,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      assignEvaluator(
        {
          organizationId,
          evaluatorUserId: evaluatorId,
          tryoutId,
          scope: { kind: 'division', divisionId: '55555555-5555-4555-8555-555555555555' },
        },
        director,
        gateway,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
  });

  it('never widens a list request beyond the evaluator current assignment', async () => {
    const evaluator: AuthorizationContext = {
      userId: evaluatorId,
      organizationId,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [{ role: 'evaluator', scope: { kind: 'division', tryoutId, divisionId } }],
    };
    const gateway = { list: async () => [] };

    await expect(
      listAssignedAthletes({ organizationId, tryoutId }, evaluator, gateway),
    ).resolves.toEqual({
      ok: true,
      value: [],
    });
    await expect(
      listAssignedAthletes(
        { organizationId, tryoutId: '99999999-9999-4999-8999-999999999999' },
        evaluator,
        gateway,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
  });

  it('enforces live JWT scope and blind projection against the local database', async () => {
    const id = () => randomUUID();
    const owner = id();
    const evaluator = id();
    const otherOwner = id();
    const organization = id();
    const otherOrganization = id();
    const tryout = id();
    const division = id();
    const session = id();
    const blue = id();
    const gold = id();
    const form = id();
    const version = id();
    const athleteBlue = id();
    const athleteGold = id();
    const registrationBlue = id();
    const registrationGold = id();
    const suffix = tryout.slice(0, 8);
    try {
      await psql(`
        insert into auth.users(id) values('${owner}'),('${evaluator}'),('${otherOwner}');
        insert into public.organizations(id,name,slug,timezone) values
          ('${organization}','JWT Staffing','jwt-staffing-${suffix}','America/Edmonton'),
          ('${otherOrganization}','Other JWT Staffing','other-jwt-staffing-${suffix}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organization}','${owner}','owner','active'),('${organization}','${evaluator}','member','active'),
          ('${otherOrganization}','${otherOwner}','owner','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone,blind_mode)
          values('${tryout}','${organization}','JWT Camp','jwt-camp-${suffix}','Hockey','America/Edmonton',true);
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
          values('${division}','${organization}','${tryout}','U13',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order)
          values('${session}','${organization}','${tryout}','${division}','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
        insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values
          ('${blue}','${organization}','${tryout}','${session}','Blue',0),
          ('${gold}','${organization}','${tryout}','${session}','Gold',1);
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${form}','${organization}','${tryout}','Form');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
          values('${version}','${organization}','${tryout}','${form}',1,'{"fields":[]}','published',clock_timestamp());
        insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
          ('${athleteBlue}','${organization}','Private','Blue','private','blue','2013-01-01'),
          ('${athleteGold}','${organization}','Private','Gold','private','gold','2013-01-02');
        insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
          ('${registrationBlue}','${organization}','${tryout}','${athleteBlue}','${division}','${version}','{}',repeat('a',64),repeat('1',64)),
          ('${registrationGold}','${organization}','${tryout}','${athleteGold}','${division}','${version}','{}',repeat('b',64),repeat('2',64));
        insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id) values
          ('${organization}','${tryout}','${registrationBlue}','${session}','${blue}'),
          ('${organization}','${tryout}','${registrationGold}','${session}','${gold}');
        set session_replication_role=replica;
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryout}';
        set session_replication_role=origin;
      `);
      await psql(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true); select outcome from public.assign_evaluator('${organization}','${evaluator}','${tryout}','group',null,'${session}','${blue}',null); commit;`,
      );
      expect(
        (
          await psql(
            `select count(*) from public.tryout_staff_assignments where organization_id='${organization}' and user_id='${evaluator}' and role='evaluator' and scope_kind='group' and group_id='${blue}' and revoked_at is null`,
          )
        ).stdout.trim(),
      ).toBe('1');

      // Exercise the projection as the evaluator's live JWT identity.
      const projection = await psql(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${evaluator}',true); select registration_id||'|'||display_name||'|'||identity_mode from public.list_assigned_athletes('${organization}','${tryout}');`,
      );
      expect(projection.stdout).toContain(`${registrationBlue}|Athlete `);
      expect(projection.stdout).toContain('|blind');
      expect(projection.stdout).not.toContain(registrationGold);
      expect(projection.stdout).not.toContain('Private');

      const crossTenant = await psql(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${otherOwner}',true); select count(*) from public.list_assigned_athletes('${organization}','${tryout}');`,
      );
      expect(crossTenant.stdout.split('\n')).toContain('0');
    } finally {
      await psql(`
        set session_replication_role=replica;
        delete from public.audit_logs where organization_id in ('${organization}','${otherOrganization}');
        delete from public.session_enrollments where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryout_registrations where organization_id in ('${organization}','${otherOrganization}');
        delete from public.athletes where organization_id in ('${organization}','${otherOrganization}');
        delete from public.registration_form_versions where organization_id in ('${organization}','${otherOrganization}');
        delete from public.registration_forms where organization_id in ('${organization}','${otherOrganization}');
        delete from public.session_groups where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryout_sessions where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryout_divisions where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryout_staff_assignments where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryouts where organization_id in ('${organization}','${otherOrganization}');
        delete from public.organization_members where organization_id in ('${organization}','${otherOrganization}');
        delete from public.profiles where id in ('${owner}','${evaluator}','${otherOwner}');
        delete from public.organizations where id in ('${organization}','${otherOrganization}');
        delete from auth.users where id in ('${owner}','${evaluator}','${otherOwner}');
        set session_replication_role=origin;
      `).catch(() => undefined);
    }
  });
});
