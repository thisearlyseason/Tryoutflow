import { describe, expect, it, vi } from 'vitest';

import { parseOrganizationId } from '../../../src/lib/ids';
import { SupabaseAuditEventListGateway } from '../../../src/modules/audit/infrastructure/supabase-audit-event-list-gateway';
import { SupabasePlatformAdministrationGateway } from '../../../src/modules/observability/infrastructure/supabase-platform-administration-gateway';

describe('Supabase operational gateways', () => {
  it('maps platform organization RPC rows to the public metadata allow-list', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          organization_id: '11111111-1111-4111-8111-111111111111',
          organization_name: 'Badlands Hockey',
          organization_slug: 'badlands-hockey',
          organization_status: 'active',
          organization_created_at: '2026-08-31T18:00:00.000Z',
        },
      ],
      error: null,
    });
    const gateway = new SupabasePlatformAdministrationGateway({ rpc } as never);

    await expect(gateway.listOrganizations(20)).resolves.toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Badlands Hockey',
        slug: 'badlands-hockey',
        status: 'active',
        createdAt: '2026-08-31T18:00:00.000Z',
      },
    ]);
    expect(rpc).toHaveBeenCalledWith('platform_list_organizations', { p_limit: 20 });
  });

  it('maps support elevation outcomes without adding an impersonated user input', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          outcome: 'started',
          elevation_id: '22222222-2222-4222-8222-222222222222',
          expires_at: '2026-08-31T18:30:00.000Z',
        },
      ],
      error: null,
    });
    const gateway = new SupabasePlatformAdministrationGateway({ rpc } as never);

    await expect(
      gateway.begin({
        organizationId: parseOrganizationId('11111111-1111-4111-8111-111111111111'),
        reason: 'Investigate support ticket T32-100',
        expiresAt: new Date('2026-08-31T18:30:00.000Z'),
      }),
    ).resolves.toEqual({
      outcome: 'started',
      elevationId: '22222222-2222-4222-8222-222222222222',
      expiresAt: '2026-08-31T18:30:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('begin_support_elevation', {
      p_organization_id: '11111111-1111-4111-8111-111111111111',
      p_reason: 'Investigate support ticket T32-100',
      p_expires_at: '2026-08-31T18:30:00.000Z',
    });
  });

  it('loads organization audit fields without selecting generic details', async () => {
    const select = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = {
      from: vi.fn().mockReturnValue({ select, eq, order, limit }),
    };
    const gateway = new SupabaseAuditEventListGateway(client as never, {
      findAuthorizationContext: vi.fn(),
    });

    await expect(
      gateway.listEvents(parseOrganizationId('11111111-1111-4111-8111-111111111111'), 20),
    ).resolves.toEqual([]);
    expect(select).toHaveBeenCalledWith(
      'id,organization_id,actor_user_id,action,entity_type,entity_id,occurred_at',
    );
  });

  it('normalizes database failures without propagating raw provider messages', async () => {
    const denied = new SupabasePlatformAdministrationGateway({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'private database policy detail' },
      }),
    } as never);
    const unavailable = new SupabasePlatformAdministrationGateway({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'postgres host and credential detail' },
      }),
    } as never);

    await expect(denied.health()).rejects.toMatchObject({
      category: 'permission',
      code: 'platform_forbidden',
    });
    await expect(unavailable.listOrganizations()).rejects.toMatchObject({
      category: 'unexpected',
      code: 'platform_unavailable',
    });
    await expect(unavailable.listOrganizations()).rejects.not.toThrow(/credential|postgres host/iu);
  });
});
