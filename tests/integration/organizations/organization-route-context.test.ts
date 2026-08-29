// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import {
  canManageTryoutStaffing,
  resolveOrganizationRouteContext,
  type OrganizationRouteContextGateway,
} from '../../../src/modules/organizations/application/organization-route-context';
import { buildAuthorizationContext } from '../../../src/modules/organizations/infrastructure/membership-repository';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);

describe('organization route context against live RLS', () => {
  it('loads an exact scoped director but denies cross-tenant, inactive, and revoked staffing access', async () => {
    const director = randomUUID() as UserId;
    const inactive = randomUUID() as UserId;
    const organization = randomUUID() as OrganizationId;
    const otherOrganization = randomUUID();
    const tryout = randomUUID();
    const division = randomUUID();
    const session = randomUUID();
    const assignment = randomUUID();
    const suffix = organization.slice(0, 8);
    const slug = `route-context-${suffix}`;
    const otherSlug = `route-context-other-${suffix}`;

    const gatewayFor = (actor: UserId): OrganizationRouteContextGateway => ({
      async findOrganizationShellBySlug(targetSlug) {
        const { stdout } = await psql(`
          begin;
          set local role authenticated;
          select set_config('request.jwt.claim.sub','${actor}',true);
          select id||'|'||name||'|'||slug from public.organizations where slug='${targetSlug}';
        `);
        const row = stdout
          .trim()
          .split('\n')
          .find((line) => line.includes('|'));
        if (!row) return null;
        const [id, name, foundSlug] = row.split('|');
        return { id: id as OrganizationId, name: name!, slug: foundSlug! };
      },
      async findAuthorizationContext(_userId, organizationId) {
        const membership = await psql(`
          begin;
          set local role authenticated;
          select set_config('request.jwt.claim.sub','${actor}',true);
          select role||'|'||status from public.organization_members
          where organization_id='${organizationId}' and user_id='${actor}';
        `);
        const membershipRow = membership.stdout
          .trim()
          .split('\n')
          .find((line) => line.includes('|'));
        if (!membershipRow) return null;
        const [role, status] = membershipRow.split('|');
        const grants = await psql(`
          begin;
          set local role authenticated;
          select set_config('request.jwt.claim.sub','${actor}',true);
          select role||'|'||scope_kind||'|'||tryout_id||'|'||coalesce(division_id::text,'')||'|'||
            coalesce(session_id::text,'')||'|'||coalesce(group_id::text,'')||'|'||
            coalesce(revoked_at::text,'')||'|'||coalesce(expires_at::text,'')
          from public.tryout_staff_assignments
          where organization_id='${organizationId}' and user_id='${actor}';
        `);
        return buildAuthorizationContext(
          { organizationId, userId: actor, role: role!, status: status! },
          grants.stdout
            .trim()
            .split('\n')
            .filter((line) => line.split('|').length === 8)
            .map((line) => {
              const [
                grantRole,
                scopeKind,
                tryoutId,
                divisionId,
                sessionId,
                groupId,
                revokedAt,
                expiresAt,
              ] = line.split('|');
              return {
                role: grantRole!,
                scopeKind: scopeKind!,
                tryoutId: tryoutId!,
                divisionId: divisionId || null,
                sessionId: sessionId || null,
                groupId: groupId || null,
                revokedAt: revokedAt || null,
                expiresAt: expiresAt || null,
              };
            }),
          new Date(),
        );
      },
    });

    try {
      await psql(`
        insert into auth.users(id) values('${director}'),('${inactive}');
        insert into public.organizations(id,name,slug,timezone) values
          ('${organization}','Route Context','${slug}','America/Edmonton'),
          ('${otherOrganization}','Other Route Context','${otherSlug}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organization}','${director}','member','active'),
          ('${organization}','${inactive}','member','disabled');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
          values('${tryout}','${organization}','Scoped Tryout','scoped-${suffix}','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
          values('${division}','${organization}','${tryout}','U13',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order)
          values('${session}','${organization}','${tryout}','${division}','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
        insert into public.tryout_staff_assignments(id,organization_id,user_id,role,scope_kind,tryout_id,session_id,granted_by_user_id)
          values('${assignment}','${organization}','${director}','director','session','${tryout}','${session}','${director}');
      `);

      const visibility = await psql(`
        begin;
        set local role authenticated;
        select set_config('request.jwt.claim.sub','${director}',true);
        select auth.uid()::text||'|'||public.is_active_organization_member('${organization}')::text||'|'||count(*)::text
        from public.organizations where slug='${slug}';
      `);
      expect(visibility.stdout).toContain(`${director}|true|1`);
      const directorGateway = gatewayFor(director);
      expect(await directorGateway.findOrganizationShellBySlug(slug)).toEqual({
        id: organization,
        name: 'Route Context',
        slug,
      });
      expect(await directorGateway.findAuthorizationContext(director, organization)).not.toBeNull();
      const context = await resolveOrganizationRouteContext(slug, director, directorGateway);
      expect(context?.organization).toEqual({ id: organization, name: 'Route Context', slug });
      expect(canManageTryoutStaffing(context!.authorization, tryout)).toBe(true);
      await expect(
        resolveOrganizationRouteContext(otherSlug, director, gatewayFor(director)),
      ).resolves.toBeNull();
      await expect(
        resolveOrganizationRouteContext(slug, inactive, gatewayFor(inactive)),
      ).resolves.toBeNull();

      await psql(
        `update public.tryout_staff_assignments set revoked_at=clock_timestamp() where id='${assignment}'`,
      );
      const revoked = await resolveOrganizationRouteContext(slug, director, gatewayFor(director));
      expect(revoked).not.toBeNull();
      expect(canManageTryoutStaffing(revoked!.authorization, tryout)).toBe(false);
    } finally {
      await psql(`
        set session_replication_role=replica;
        delete from public.tryout_staff_assignments where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryout_sessions where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryout_divisions where organization_id in ('${organization}','${otherOrganization}');
        delete from public.tryouts where organization_id in ('${organization}','${otherOrganization}');
        delete from public.organization_members where organization_id in ('${organization}','${otherOrganization}');
        delete from public.profiles where id in ('${director}','${inactive}');
        delete from public.organizations where id in ('${organization}','${otherOrganization}');
        delete from auth.users where id in ('${director}','${inactive}');
        set session_replication_role=origin;
      `).catch(() => undefined);
    }
  });
});
