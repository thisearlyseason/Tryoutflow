// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  createStaffRegistration,
  type StaffRegistrationGateway,
} from '../../../src/modules/registration/application/create-staff-registration';
import type { RegistrationFormSchema } from '../../../src/modules/registration/domain/form-schema';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
const sqlText = (value: string) => value.replaceAll("'", "''");

describe('staff registration application/database conflict boundary', () => {
  it('returns one exact conflict under concurrency and keeps the winning replay stable', async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const tryoutId = randomUUID();
    const divisionId = randomUUID();
    const formId = randomUUID();
    const formVersionId = randomUUID();
    const idempotencyKey = randomUUID();
    const authorization: AuthorizationContext = {
      userId: userId as UserId,
      organizationId: organizationId as OrganizationId,
      organizationRole: 'owner',
      membershipStatus: 'active',
      assignments: [],
    };
    const form: RegistrationFormSchema = {
      fields: [
        {
          key: 'consent',
          label: 'I consent',
          kind: 'consent',
          required: true,
          sortOrder: 0,
        },
      ],
    };
    const gateway: StaffRegistrationGateway = {
      async create(input) {
        const responses = sqlText(JSON.stringify(input.responses));
        const optional = (value: string | undefined, cast = '') =>
          value ? `'${sqlText(value)}'${cast}` : `null${cast}`;
        const { stdout } = await psql(`
          begin;
          set local statement_timeout='10s';
          set local role authenticated;
          set local "request.jwt.claim.role"='authenticated';
          set local "request.jwt.claim.sub"='${userId}';
          create temporary table staff_registration_result on commit preserve rows as
            select * from public.create_staff_registration(
              '${input.organizationId}','${input.tryoutId}',
              ${optional(input.existingAthleteId, '::uuid')},'${input.divisionId}',
              ${optional(input.positionId, '::uuid')},${optional(input.givenName)},
              ${optional(input.familyName)},${optional(input.birthDate, '::date')},
              '${responses}'::jsonb,'${input.submissionKeyDigest}'
            );
          commit;
          select outcome||'|'||coalesce(registration_id::text,'')||'|'||coalesce(athlete_id::text,'')
          from staff_registration_result;
        `);
        const [outcome = '', registrationId = '', athleteId = ''] = stdout.trim().split('|');
        return {
          outcome,
          registrationId: registrationId || undefined,
          athleteId: athleteId || undefined,
        };
      },
    };
    const baseInput = {
      organizationId,
      tryoutId,
      divisionId,
      familyName: 'Concurrency',
      birthDate: '2014-01-02',
      responses: { consent: true },
      idempotencyKey,
    };
    const firstInput = { ...baseInput, givenName: 'First' };
    const secondInput = { ...baseInput, givenName: 'Second' };

    try {
      await psql(`
        insert into auth.users(id,email,email_confirmed_at)
          values('${userId}','staff-conflict-${userId}@example.test',clock_timestamp());
        insert into public.organizations(id,name,slug)
          values('${organizationId}','Staff Conflict','staff-conflict-${organizationId.slice(0, 8)}');
        insert into public.organization_members(organization_id,user_id,role,status)
          values('${organizationId}','${userId}','owner','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
          values('${tryoutId}','${organizationId}','Staff Conflict Tryout','staff-conflict-tryout','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
          values('${divisionId}','${organizationId}','${tryoutId}','U13',0);
        insert into public.registration_forms(id,organization_id,tryout_id,name)
          values('${formId}','${organizationId}','${tryoutId}','Staff conflict form');
        insert into public.registration_form_versions(
          id,organization_id,tryout_id,registration_form_id,version_number,schema,status
        ) values(
          '${formVersionId}','${organizationId}','${tryoutId}','${formId}',1,
          '${sqlText(JSON.stringify(form))}'::jsonb,'draft'
        );
        insert into public.tryout_registration_form_selections(
          organization_id,tryout_id,registration_form_version_id
        ) values('${organizationId}','${tryoutId}','${formVersionId}');
      `);

      const results = await Promise.all(
        [firstInput, secondInput].map((input) =>
          createStaffRegistration(input, { authorization }, { form, gateway }),
        ),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, error: { code: 'idempotency_conflict' } },
      ]);

      const winningInput = results[0]?.ok ? firstInput : secondInput;
      await expect(
        createStaffRegistration(winningInput, { authorization }, { form, gateway }),
      ).resolves.toEqual(
        expect.objectContaining({
          ok: true,
          value: expect.objectContaining({ replayed: true }),
        }),
      );
      expect(
        (
          await psql(`
            select count(*)||'|'||
              (select count(*) from public.athletes where organization_id='${organizationId}')||'|'||
              (select count(*) from public.audit_logs where organization_id='${organizationId}' and action='registration.staff_created')
            from public.tryout_registrations where organization_id='${organizationId}'
          `)
        ).stdout.trim(),
      ).toBe('1|1|1');
    } finally {
      await psql(`
        begin;
        set local session_replication_role=replica;
        delete from public.audit_logs where organization_id='${organizationId}';
        delete from public.tryout_registrations where organization_id='${organizationId}';
        delete from public.athletes where organization_id='${organizationId}';
        delete from public.tryout_registration_form_selections where organization_id='${organizationId}';
        delete from public.registration_form_versions where organization_id='${organizationId}';
        delete from public.registration_forms where organization_id='${organizationId}';
        delete from public.tryout_divisions where organization_id='${organizationId}';
        delete from public.tryouts where organization_id='${organizationId}';
        delete from public.organization_members where organization_id='${organizationId}';
        delete from public.profiles where id='${userId}';
        delete from public.organizations where id='${organizationId}';
        delete from auth.users where id='${userId}';
        set local session_replication_role=origin;
        commit;
      `);
    }
  });
});
