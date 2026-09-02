// @vitest-environment node

import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  updateOrganizationLogo,
  type OrganizationLogoGateway,
} from '../../../src/modules/organizations/application/update-organization-logo';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);

beforeAll(() => {
  const config = execFileSync(
    'docker',
    ['exec', 'supabase_kong_tryoutflow', 'cat', '/home/kong/kong.yml'],
    { encoding: 'utf8' },
  );
  const serviceKey = config.match(/sb_secret_[A-Za-z0-9_-]+/u)?.[0];
  const publishableKey = config.match(/sb_publishable_[A-Za-z0-9_-]+/u)?.[0];
  if (!serviceKey || !publishableKey) throw new Error('local Supabase API keys unavailable');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishableKey;
  process.env.PUBLIC_REGISTRATION_RATE_LIMIT_SECRET = 'organization-logo-route-integration-secret';
});

function authorization(
  organizationId: OrganizationId,
  userId: UserId,
  role: 'owner' | 'administrator' | 'member',
): AuthorizationContext {
  return {
    userId,
    organizationId,
    organizationRole: role,
    membershipStatus: 'active',
    assignments: [],
  };
}

function rpcGateway(actorUserId: UserId): OrganizationLogoGateway {
  const call = async (sql: string) => {
    const { stdout } = await psql(`
      begin;
      set local role authenticated;
      set local "request.jwt.claim.role"='authenticated';
      set local "request.jwt.claim.sub"='${actorUserId}';
      create temporary table organization_logo_rpc_result on commit preserve rows as ${sql};
      commit;
      table organization_logo_rpc_result;
    `);
    return stdout.trim().split('\n').at(-1) ?? '';
  };
  return {
    upsert: ({ organizationId, base64, sha256 }) =>
      call(`select public.upsert_organization_logo('${organizationId}','${base64}','${sha256}')`),
    remove: ({ organizationId }) =>
      call(`select public.remove_organization_logo('${organizationId}')`),
  };
}

async function logoFile(color: { r: number; g: number; b: number }) {
  const bytes = await sharp({
    create: { width: 640, height: 320, channels: 4, background: { ...color, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return new File([new Uint8Array(bytes)], 'untrusted-name.png', { type: 'image/png' });
}

describe('organization logo application boundary against PostgreSQL', () => {
  it('authorizes owner/admin replacement and removal, audits exact rows, and retains old bytes on failure', async () => {
    const organizationId = randomUUID() as OrganizationId;
    const ownerId = randomUUID() as UserId;
    const administratorId = randomUUID() as UserId;
    const memberId = randomUUID() as UserId;
    const slug = `logo-integration-${organizationId.slice(0, 8)}`;
    const owner = {
      userId: ownerId,
      authorization: authorization(organizationId, ownerId, 'owner'),
    };
    const administrator = {
      userId: administratorId,
      authorization: authorization(organizationId, administratorId, 'administrator'),
    };

    try {
      await psql(`
        insert into auth.users(id,email,email_confirmed_at) values
          ('${ownerId}','owner-${organizationId}@example.test',clock_timestamp()),
          ('${administratorId}','admin-${organizationId}@example.test',clock_timestamp()),
          ('${memberId}','member-${organizationId}@example.test',clock_timestamp());
        insert into public.organizations(id,name,slug,timezone)
          values('${organizationId}','Logo Integration','${slug}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organizationId}','${ownerId}','owner','active'),
          ('${organizationId}','${administratorId}','administrator','active'),
          ('${organizationId}','${memberId}','member','active');
      `);

      const uploaded = await updateOrganizationLogo(
        { organizationId, file: await logoFile({ r: 25, g: 85, b: 160 }) },
        owner,
        { gateway: rpcGateway(ownerId) },
      );
      expect(uploaded).toEqual({
        ok: true,
        value: {
          kind: 'updated',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          byteLength: expect.any(Number),
        },
      });
      if (!uploaded.ok || uploaded.value.kind !== 'updated') {
        throw new Error('owner upload failed');
      }

      const { GET: getLogo } =
        await import('../../../src/app/api/organizations/[organizationSlug]/logo/route');
      const routeContext = {
        params: Promise.resolve({ organizationSlug: slug }),
      } as RouteContext<'/api/organizations/[organizationSlug]/logo'>;
      const delivered = await getLogo(
        new NextRequest(`http://localhost/api/organizations/${slug}/logo`),
        routeContext,
      );
      expect(delivered.status).toBe(200);
      expect(delivered.headers.get('content-type')).toBe('image/webp');
      expect(delivered.headers.get('etag')).toBe(`"${uploaded.value.sha256}"`);
      expect(Buffer.from(await delivered.arrayBuffer())).toHaveLength(uploaded.value.byteLength);
      const notModified = await getLogo(
        new NextRequest(`http://localhost/api/organizations/${slug}/logo`, {
          headers: { 'if-none-match': `"${uploaded.value.sha256}"` },
        }),
        routeContext,
      );
      expect(notModified.status).toBe(304);
      expect(await notModified.text()).toBe('');

      expect(
        (
          await psql(`
            select sha256||'|'||byte_length||'|'||content_type||'|'||updated_by_user_id
            from private.organization_brand_assets where organization_id='${organizationId}'
          `)
        ).stdout.trim(),
      ).toBe(`${uploaded.value.sha256}|${uploaded.value.byteLength}|image/webp|${ownerId}`);

      const replaced = await updateOrganizationLogo(
        { organizationId, file: await logoFile({ r: 200, g: 70, b: 40 }) },
        administrator,
        { gateway: rpcGateway(administratorId) },
      );
      expect(replaced).toEqual({
        ok: true,
        value: {
          kind: 'updated',
          sha256: expect.not.stringMatching(uploaded.value.sha256),
          byteLength: expect.any(Number),
        },
      });
      if (!replaced.ok || replaced.value.kind !== 'updated') {
        throw new Error('administrator replacement failed');
      }

      const beforeFailure = (
        await psql(`
          select encode(content,'base64')||'|'||sha256||'|'||byte_length
          from private.organization_brand_assets where organization_id='${organizationId}'
        `)
      ).stdout.trim();
      await expect(
        updateOrganizationLogo(
          {
            organizationId,
            file: new File([new TextEncoder().encode('not an image')], 'private-filename.png', {
              type: 'image/png',
            }),
          },
          owner,
          { gateway: rpcGateway(ownerId) },
        ),
      ).resolves.toEqual({ ok: false, error: { code: 'invalid_file' } });
      expect(
        (
          await psql(`
            select encode(content,'base64')||'|'||sha256||'|'||byte_length
            from private.organization_brand_assets where organization_id='${organizationId}'
          `)
        ).stdout.trim(),
      ).toBe(beforeFailure);

      await expect(
        updateOrganizationLogo(
          { organizationId, file: await logoFile({ r: 0, g: 0, b: 0 }) },
          owner,
          { gateway: rpcGateway(memberId) },
        ),
      ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
      expect(
        (
          await psql(
            `select sha256 from private.organization_brand_assets where organization_id='${organizationId}'`,
          )
        ).stdout.trim(),
      ).toBe(replaced.value.sha256);

      const auditBeforeRemoval = (
        await psql(`
          select action||'|'||actor_user_id||'|'||(details->>'sha256')||'|'||(details->>'byteLength')
          from public.audit_logs
          where organization_id='${organizationId}' and action='organization.logo_updated'
          order by occurred_at,id
        `)
      ).stdout
        .trim()
        .split('\n');
      expect(auditBeforeRemoval).toEqual([
        `organization.logo_updated|${ownerId}|${uploaded.value.sha256}|${uploaded.value.byteLength}`,
        `organization.logo_updated|${administratorId}|${replaced.value.sha256}|${replaced.value.byteLength}`,
      ]);

      await expect(
        updateOrganizationLogo({ organizationId, remove: true }, administrator, {
          gateway: rpcGateway(administratorId),
        }),
      ).resolves.toEqual({ ok: true, value: { kind: 'removed' } });
      expect(
        (
          await psql(
            `select count(*) from private.organization_brand_assets where organization_id='${organizationId}'`,
          )
        ).stdout.trim(),
      ).toBe('0');
      expect(
        (
          await psql(`
            select action||'|'||actor_user_id||'|'||(details->>'sha256')||'|'||(details->>'byteLength')
            from public.audit_logs
            where organization_id='${organizationId}' and action='organization.logo_removed'
          `)
        ).stdout.trim(),
      ).toBe(
        `organization.logo_removed|${administratorId}|${replaced.value.sha256}|${replaced.value.byteLength}`,
      );
      const missing = await getLogo(
        new NextRequest(`http://localhost/api/organizations/${slug}/logo`),
        routeContext,
      );
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe('Logo unavailable.');
    } finally {
      await psql(`
        begin;
        set local session_replication_role=replica;
        delete from public.audit_logs where organization_id='${organizationId}';
        delete from private.organization_brand_assets where organization_id='${organizationId}';
        delete from public.organization_members where organization_id='${organizationId}';
        delete from public.profiles where id in('${ownerId}','${administratorId}','${memberId}');
        delete from public.organizations where id='${organizationId}';
        delete from auth.users where id in('${ownerId}','${administratorId}','${memberId}');
        set local session_replication_role=origin;
        commit;
      `).catch(() => undefined);
    }
  });
});
