// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);

describe('membership command concurrency', () => {
  it('serializes exact and conflicting replays and appends each audit event once', async () => {
    const organizationId = randomUUID();
    const ownerUserId = randomUUID();
    const ownerMemberId = randomUUID();
    const exactUserId = randomUUID();
    const exactMemberId = randomUUID();
    const conflictUserId = randomUUID();
    const conflictMemberId = randomUUID();
    const transferUserId = randomUUID();
    const transferMemberId = randomUUID();
    const exactKey = randomUUID();
    const conflictKey = randomUUID();
    const transferKey = randomUUID();
    const slug = `membership-concurrency-${organizationId.slice(0, 8)}`;
    const callAsOwner = (command: string) =>
      psql(`
        begin;
        set local statement_timeout='10s';
        set local role authenticated;
        set local "request.jwt.claim.role"='authenticated';
        set local "request.jwt.claim.sub"='${ownerUserId}';
        create temporary table membership_rpc_result on commit preserve rows as
          ${command};
        commit;
        table membership_rpc_result;
      `);

    try {
      await psql(`
        insert into auth.users(id,email,email_confirmed_at) values
          ('${ownerUserId}','owner-${organizationId}@example.test',clock_timestamp()),
          ('${exactUserId}','exact-${organizationId}@example.test',clock_timestamp()),
          ('${conflictUserId}','conflict-${organizationId}@example.test',clock_timestamp()),
          ('${transferUserId}','transfer-${organizationId}@example.test',clock_timestamp());
        insert into public.organizations(id,name,slug)
          values('${organizationId}','Concurrent Membership','${slug}');
        insert into public.organization_members(id,organization_id,user_id,role,status) values
          ('${ownerMemberId}','${organizationId}','${ownerUserId}','owner','active'),
          ('${exactMemberId}','${organizationId}','${exactUserId}','member','active'),
          ('${conflictMemberId}','${organizationId}','${conflictUserId}','member','active'),
          ('${transferMemberId}','${organizationId}','${transferUserId}','administrator','active');
      `);

      const exactCommand = `
        select outcome||'|'||member_id||'|'||role||'|'||status||'|'||version
        from public.change_organization_member(
          '${organizationId}','${exactMemberId}','member','disabled',0,'${exactKey}'
        )
      `;
      const exactResults = await Promise.all([
        callAsOwner(exactCommand),
        callAsOwner(exactCommand),
      ]);
      expect(exactResults.map(({ stdout }) => stdout.trim())).toEqual([
        `updated|${exactMemberId}|member|disabled|1`,
        `updated|${exactMemberId}|member|disabled|1`,
      ]);
      expect(
        (
          await psql(`
            select count(*) from public.audit_logs
            where organization_id='${organizationId}'
              and entity_id='${exactMemberId}'
              and action='organization.member.status_changed'
          `)
        ).stdout.trim(),
      ).toBe('1');

      const conflictingResults = await Promise.all([
        callAsOwner(`
          select outcome from public.change_organization_member(
            '${organizationId}','${conflictMemberId}','member','disabled',0,'${conflictKey}'
          )
        `),
        callAsOwner(`
          select outcome from public.change_organization_member(
            '${organizationId}','${conflictMemberId}','administrator','active',0,'${conflictKey}'
          )
        `),
      ]);
      expect(conflictingResults.map(({ stdout }) => stdout.trim()).sort()).toEqual([
        'conflict',
        'updated',
      ]);
      expect(
        (
          await psql(`
            select count(*) from public.audit_logs
            where organization_id='${organizationId}'
              and entity_id='${conflictMemberId}'
              and action in(
                'organization.member.role_changed','organization.member.status_changed'
              )
          `)
        ).stdout.trim(),
      ).toBe('1');

      const transferCommand = `
        select outcome||'|'||former_owner_member_id||'|'||new_owner_member_id
        from public.transfer_organization_ownership(
          '${organizationId}','${transferMemberId}',0,0,'${transferKey}'
        )
      `;
      const transferResults = await Promise.all([
        callAsOwner(transferCommand),
        callAsOwner(transferCommand),
      ]);
      expect(transferResults.map(({ stdout }) => stdout.trim())).toEqual([
        `transferred|${ownerMemberId}|${transferMemberId}`,
        `transferred|${ownerMemberId}|${transferMemberId}`,
      ]);
      expect(
        (
          await psql(`
            select count(*) from public.audit_logs
            where organization_id='${organizationId}'
              and entity_id='${transferMemberId}'
              and action='organization.ownership.transferred'
          `)
        ).stdout.trim(),
      ).toBe('1');
      expect(
        (
          await psql(`
            select count(*)||'|'||bool_and(result_digest~'^[0-9a-f]{64}$')
            from private.membership_command_receipts
            where organization_id='${organizationId}'
          `)
        ).stdout.trim(),
      ).toBe('3|true');
    } finally {
      await psql(`
        begin;
        set local session_replication_role=replica;
        delete from private.membership_command_receipts where organization_id='${organizationId}';
        delete from public.audit_logs where organization_id='${organizationId}';
        delete from public.organization_members where organization_id='${organizationId}';
        delete from public.profiles where id in(
          '${ownerUserId}','${exactUserId}','${conflictUserId}','${transferUserId}'
        );
        delete from public.organizations where id='${organizationId}';
        delete from auth.users where id in(
          '${ownerUserId}','${exactUserId}','${conflictUserId}','${transferUserId}'
        );
        set local session_replication_role=origin;
        commit;
      `);
    }
  });
});
