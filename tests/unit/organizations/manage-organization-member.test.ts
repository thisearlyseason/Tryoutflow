import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import {
  changeOrganizationMember,
  transferOrganizationOwnership,
  type MembershipCommandGateway,
} from '../../../src/modules/organizations/application/manage-organization-member';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const actorUserId = '11111111-1111-4111-8111-111111111111' as UserId;
const memberId = '22222222-2222-4222-8222-222222222222';
const requestKey = '33333333-3333-4333-8333-333333333333';

function authorization(role: 'owner' | 'administrator' | 'member'): AuthorizationContext {
  return {
    userId: actorUserId,
    organizationId,
    organizationRole: role,
    membershipStatus: 'active',
    assignments: [],
  };
}

describe('organization membership commands', () => {
  it('validates and authorizes a role/status change before invoking the gateway', async () => {
    const gateway: MembershipCommandGateway = {
      change: vi.fn(),
      transfer: vi.fn(),
    };

    await expect(
      changeOrganizationMember(
        {
          organizationId,
          memberId,
          role: 'member',
          status: 'disabled',
          expectedVersion: -1,
          idempotencyKey: requestKey,
        },
        { authorization: authorization('owner') },
        { gateway },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_input' } });
    await expect(
      changeOrganizationMember(
        {
          organizationId,
          memberId,
          role: 'member',
          status: 'disabled',
          expectedVersion: 0,
          idempotencyKey: requestKey,
        },
        { authorization: authorization('member') },
        { gateway },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(gateway.change).not.toHaveBeenCalled();
  });

  it('returns the locked database result for a valid membership change', async () => {
    const gateway: MembershipCommandGateway = {
      change: vi.fn().mockResolvedValue({
        outcome: 'updated',
        memberId,
        role: 'administrator',
        status: 'active',
        version: 4,
      }),
      transfer: vi.fn(),
    };

    await expect(
      changeOrganizationMember(
        {
          organizationId,
          memberId,
          role: 'administrator',
          status: 'active',
          expectedVersion: 3,
          idempotencyKey: requestKey,
        },
        { authorization: authorization('owner') },
        { gateway },
      ),
    ).resolves.toEqual({
      ok: true,
      value: { memberId, role: 'administrator', status: 'active', version: 4 },
    });
  });

  it('maps database concurrency and concealment outcomes without exposing details', async () => {
    const gateway: MembershipCommandGateway = {
      change: vi.fn().mockResolvedValue({ outcome: 'conflict' }),
      transfer: vi.fn(),
    };

    await expect(
      changeOrganizationMember(
        {
          organizationId,
          memberId,
          role: 'member',
          status: 'active',
          expectedVersion: 0,
          idempotencyKey: requestKey,
        },
        { authorization: authorization('administrator') },
        { gateway },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'conflict' } });
  });

  it('allows only an owner context to request the atomic ownership transfer', async () => {
    const gateway: MembershipCommandGateway = {
      change: vi.fn(),
      transfer: vi.fn().mockResolvedValue({
        outcome: 'transferred',
        formerOwnerMemberId: '44444444-4444-4444-8444-444444444444',
        newOwnerMemberId: memberId,
      }),
    };
    const command = {
      organizationId,
      targetMemberId: memberId,
      expectedActorVersion: 1,
      expectedTargetVersion: 2,
      idempotencyKey: requestKey,
    };

    await expect(
      transferOrganizationOwnership(
        command,
        { authorization: authorization('administrator') },
        {
          gateway,
        },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    await expect(
      transferOrganizationOwnership(
        command,
        { authorization: authorization('owner') },
        {
          gateway,
        },
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        formerOwnerMemberId: '44444444-4444-4444-8444-444444444444',
        newOwnerMemberId: memberId,
      },
    });
  });

  it('fails closed when the membership command adapter is unavailable', async () => {
    const gateway: MembershipCommandGateway = {
      change: vi.fn().mockRejectedValue(new Error('db unavailable')),
      transfer: vi.fn(),
    };

    await expect(
      changeOrganizationMember(
        {
          organizationId,
          memberId,
          role: 'member',
          status: 'active',
          expectedVersion: 0,
          idempotencyKey: requestKey,
        },
        { authorization: authorization('owner') },
        { gateway },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'unavailable' } });
  });
});
