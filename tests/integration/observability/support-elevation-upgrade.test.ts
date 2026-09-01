// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const migrationUrl = new URL(
  '../../../supabase/migrations/202608310091_validate_support_elevation_history.sql',
  import.meta.url,
);

function psql(input: string): string {
  return execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', databaseUrl], {
    encoding: 'utf8',
    input,
  }).trim();
}

describe('support elevation 090 to 091 upgrade', () => {
  it('revokes malformed historical authority, preserves evidence, and validates exact bounds', () => {
    const migration = readFileSync(migrationUrl, 'utf8');
    const migrationBody = migration
      .replace(/^([\s\S]*?\n)begin;\n/u, '$1')
      .replace(/\ncommit;\s*$/u, '');
    if (migrationBody === migration)
      throw new Error('migration 091 must own one explicit transaction');
    const values = [
      [
        '01',
        "'short'",
        "transaction_timestamp()-interval '1 minute'",
        "transaction_timestamp()+interval '29 minutes'",
      ],
      [
        '02',
        "repeat('x',501)",
        "transaction_timestamp()-interval '1 minute'",
        "transaction_timestamp()+interval '29 minutes'",
      ],
      [
        '03',
        "'Investigate support ticket T32-203'",
        "transaction_timestamp()-interval '1 minute'",
        "transaction_timestamp()+interval '1 minute'",
      ],
      [
        '04',
        "'Investigate support ticket T32-204'",
        "transaction_timestamp()-interval '1 minute'",
        "transaction_timestamp()+interval '4 hours'",
      ],
      [
        '05',
        "'Investigate support ticket T32-205'",
        "transaction_timestamp()-interval '10 minutes'",
        "transaction_timestamp()-interval '5 minutes'",
      ],
      [
        '06',
        "'1234567890'",
        "transaction_timestamp()-interval '1 minute'",
        "transaction_timestamp()+interval '4 minutes'",
      ],
      [
        '07',
        "'Investigate support ticket T32-207'",
        "transaction_timestamp()-interval '1 minute'",
        "transaction_timestamp()+interval '3 hours 59 minutes'",
      ],
      [
        '08',
        "'Investigate support ticket T32-208'",
        "transaction_timestamp()+interval '1 hour'",
        "transaction_timestamp()+interval '90 minutes'",
      ],
      [
        '09',
        "'Investigate'||chr(10)||'ticket T32-209'",
        "transaction_timestamp()-interval '1 minute'",
        "transaction_timestamp()+interval '29 minutes'",
      ],
    ] as const;
    const users = values
      .map(([suffix]) => `('91000000-0000-4000-8000-0000000000${suffix}')`)
      .join(',');
    const administrators = values
      .map(
        ([suffix]) =>
          `('91000000-0000-4000-8000-0000000000${suffix}','91000000-0000-4000-8000-000000000001')`,
      )
      .join(',');
    const audits = values
      .map(
        ([suffix]) =>
          `('92000000-0000-4000-8000-0000000000${suffix}','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-0000000000${suffix}','platform.support_elevation.started','platform_support_elevation','94000000-0000-4000-8000-0000000000${suffix}',clock_timestamp(),jsonb_build_object('fixture','090'))`,
      )
      .join(',');
    const elevations = values
      .map(
        ([suffix, reason, createdAt, expiresAt]) =>
          `('94000000-0000-4000-8000-0000000000${suffix}','93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-0000000000${suffix}','91000000-0000-4000-8000-0000000000${suffix}','92000000-0000-4000-8000-0000000000${suffix}',${reason},${expiresAt},${createdAt})`,
      )
      .join(',');

    const output = psql(`
      begin;
      alter table public.platform_support_elevations
        drop constraint platform_support_elevations_reason_not_blank,
        drop constraint platform_support_elevations_reason_bound_check,
        drop constraint platform_support_elevations_duration_bound_check;
      insert into auth.users(id) values ${users};
      insert into public.organizations(id,name,slug)
        values('93000000-0000-4000-8000-000000000001','Task 32 Upgrade','task-32-upgrade');
      insert into public.platform_administrators(user_id,granted_by_user_id) values ${administrators};
      insert into public.audit_logs(id,organization_id,actor_user_id,action,entity_type,entity_id,occurred_at,details)
        values ${audits};
      insert into public.platform_support_elevations(
        id,organization_id,support_user_id,granted_by_user_id,audit_log_id,reason,expires_at,created_at
      ) values ${elevations};
      alter table public.platform_support_elevations
        add constraint platform_support_elevations_reason_not_blank
          check(char_length(trim(reason)) between 10 and 2000) not valid,
        add constraint platform_support_elevations_reason_bound_check
          check(char_length(trim(reason)) between 10 and 500) not valid,
        add constraint platform_support_elevations_duration_bound_check
          check(expires_at>=created_at+interval '5 minutes' and expires_at<=created_at+interval '4 hours') not valid;
      create temporary table support_before on commit drop as
        select id,reason,created_at,expires_at,audit_log_id from public.platform_support_elevations
        where organization_id='93000000-0000-4000-8000-000000000001';
      create temporary table audit_before on commit drop as
        select id,actor_user_id,action,entity_type,entity_id,occurred_at,details from public.audit_logs
        where organization_id='93000000-0000-4000-8000-000000000001';

      ${migrationBody}

      do $audit_immutable$ begin
        begin
          update public.audit_logs set action='changed'
          where organization_id='93000000-0000-4000-8000-000000000001';
          raise exception 'audit mutation unexpectedly succeeded';
        exception when sqlstate '55000' then null;
        end;
      end $audit_immutable$;
      create temporary table helper_results(user_suffix text primary key,active boolean) on commit drop;
      select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000006',true);
      insert into helper_results values('06',public.has_active_platform_support_elevation('93000000-0000-4000-8000-000000000001'));
      select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000007',true);
      insert into helper_results values('07',public.has_active_platform_support_elevation('93000000-0000-4000-8000-000000000001'));
      select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000004',true);
      insert into helper_results values('04',public.has_active_platform_support_elevation('93000000-0000-4000-8000-000000000001'));
      select jsonb_build_object(
        'rowCount',(select count(*) from public.platform_support_elevations where organization_id='93000000-0000-4000-8000-000000000001'),
        'revokedCount',(select count(*) from public.platform_support_elevations where organization_id='93000000-0000-4000-8000-000000000001' and revoked_at is not null),
        'activeIds',(select jsonb_agg(right(id::text,2) order by id) from public.platform_support_elevations where organization_id='93000000-0000-4000-8000-000000000001' and revoked_at is null),
        'supportUnchanged',(select bool_and(row(before.id,before.reason,before.created_at,before.expires_at,before.audit_log_id)=row(after.id,after.reason,after.created_at,after.expires_at,after.audit_log_id)) from support_before before join public.platform_support_elevations after using(id)),
        'startAuditUnchanged',(select bool_and(row(before.id,before.actor_user_id,before.action,before.entity_type,before.entity_id,before.occurred_at,before.details)=row(after.id,after.actor_user_id,after.action,after.entity_type,after.entity_id,after.occurred_at,after.details)) from audit_before before join public.audit_logs after using(id)),
        'invalidationAudits',(select count(*) from public.audit_logs where organization_id='93000000-0000-4000-8000-000000000001' and action='platform.support_elevation.invalidated'),
        'constraintsValidated',(select count(*)=3 and bool_and(convalidated) from pg_constraint where conname in('platform_support_elevations_reason_not_blank','platform_support_elevations_reason_bound_check','platform_support_elevations_duration_bound_check')),
        'helpers',(select jsonb_object_agg(user_suffix,active order by user_suffix) from helper_results)
      );
      rollback;
    `);
    const result = JSON.parse(output.split('\n').at(-1) ?? '{}');

    expect(result).toEqual({
      rowCount: 9,
      revokedCount: 7,
      activeIds: ['06', '07'],
      supportUnchanged: true,
      startAuditUnchanged: true,
      invalidationAudits: 7,
      constraintsValidated: true,
      helpers: { '04': false, '06': true, '07': true },
    });
  });
});
