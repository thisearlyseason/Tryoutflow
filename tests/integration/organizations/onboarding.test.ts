import { describe, expect, it, vi } from 'vitest';

import { acceptInvitation } from '../../../src/modules/organizations/application/accept-invitation';
import { createOrganization } from '../../../src/modules/organizations/application/create-organization';
import { inviteMember } from '../../../src/modules/organizations/application/invite-member';
import { updateOrganizationSettings } from '../../../src/modules/organizations/application/update-organization-settings';
import type { OrganizationGateway } from '../../../src/modules/organizations/domain/organization';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { OrganizationId, UserId } from '../../../src/lib/ids';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const ownerId = '11111111-1111-4111-8111-111111111111' as UserId;
const coachId = '22222222-2222-4222-8222-222222222222' as UserId;

const ownerContext: AuthorizationContext = {
  userId: ownerId,
  organizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

function gateway(overrides: Partial<OrganizationGateway> = {}): OrganizationGateway {
  return {
    createWithOwner: vi.fn(async (input) => ({
      organization: { id: organizationId, ...input },
      membership: { organizationId, userId: ownerId, role: 'owner' as const },
    })),
    createInvitation: vi.fn(async (_input) => ({ id: 'invite-1' })),
    acceptInvitation: vi.fn(async () => ({
      kind: 'accepted' as const,
      organizationId,
      organizationSlug: 'badlands-hockey-academy',
    })),
    updateSettings: vi.fn(async (input) => ({ ...input })),
    ...overrides,
  };
}

describe('organization onboarding', () => {
  it('creates an organization and owner membership atomically with a normalized slug', async () => {
    const result = await createOrganization(
      {
        name: 'Badlands Hockey Academy',
        slug: ' Badlands Hockey Academy ',
        timezone: 'America/Edmonton',
      },
      { userId: ownerId },
      { gateway: gateway() },
    );

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        organization: expect.objectContaining({ slug: 'badlands-hockey-academy' }),
        membership: { organizationId, userId: ownerId, role: 'owner' },
      }),
    });
  });

  it('maps a slug collision to a conflict without exposing database details', async () => {
    const result = await createOrganization(
      {
        name: 'Badlands Hockey Academy',
        slug: 'badlands-hockey-academy',
        timezone: 'America/Edmonton',
      },
      { userId: ownerId },
      {
        gateway: gateway({
          createWithOwner: vi.fn(async () => ({ kind: 'slug_conflict' as const })),
        }),
      },
    );

    expect(result).toEqual({ ok: false, error: { code: 'slug_conflict' } });
  });

  it('rejects a non-IANA timezone during organization creation', async () => {
    const repository = gateway();
    const result = await createOrganization(
      { name: 'Badlands Hockey Academy', slug: 'badlands-hockey-academy', timezone: 'rink-time' },
      { userId: ownerId },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'invalid_input' } });
    expect(repository.createWithOwner).not.toHaveBeenCalled();
  });

  it('issues a member invitation with a hashed token and temporary notifier port', async () => {
    const repository = gateway();

    const result = await inviteMember(
      { organizationId, email: ' Coach@Example.com ', role: 'member' },
      { userId: ownerId, authorization: ownerContext },
      { gateway: repository, tokenGenerator: () => 'high-entropy-token' },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        invitationId: 'invite-1',
        delivery: 'manual_share',
        shareUrl: '/invite/high-entropy-token',
      },
    });
    expect(repository.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'coach@example.com',
        tokenDigest: expect.not.stringMatching('high-entropy-token'),
      }),
    );
  });

  it('falls back to explicit secure sharing when the temporary notifier fails', async () => {
    const notifier = { enqueue: vi.fn(async () => Promise.reject(new Error('mail offline'))) };

    const result = await inviteMember(
      { organizationId, email: 'coach@example.com', role: 'member' },
      { userId: ownerId, authorization: ownerContext },
      { gateway: gateway(), notifier, tokenGenerator: () => 'high-entropy-token' },
    );

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        delivery: 'manual_share',
        shareUrl: '/invite/high-entropy-token',
      }),
    });
    expect(notifier.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthorized owner role assignment before issuing an invitation', async () => {
    const repository = gateway();
    const result = await inviteMember(
      { organizationId, email: 'coach@example.com', role: 'owner' },
      { userId: ownerId, authorization: ownerContext },
      { gateway: repository, notifier: { enqueue: vi.fn() } },
    );

    expect(result).toEqual({ ok: false, error: { code: 'invalid_input' } });
    expect(repository.createInvitation).not.toHaveBeenCalled();
  });

  it.each(['expired', 'wrong_email', 'duplicate_membership'] as const)(
    'does not accept an invitation when it is %s',
    async (kind) => {
      const result = await acceptInvitation(
        'valid-looking-high-entropy-token',
        { userId: coachId, email: 'coach@example.com' },
        { gateway: gateway({ acceptInvitation: vi.fn(async () => ({ kind })) }) },
      );

      expect(result).toEqual({ ok: false, error: { code: kind } });
    },
  );

  it('updates organization defaults only with a current organization capability', async () => {
    const repository = gateway();
    const result = await updateOrganizationSettings(
      { organizationId, timezone: 'America/Chicago', terminology: { athlete: 'Player' } },
      { userId: ownerId, authorization: ownerContext },
      { gateway: repository },
    );

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ timezone: 'America/Chicago' }),
    });
  });

  it('updates only submitted settings fields so existing defaults are preserved', async () => {
    const repository = gateway();
    await updateOrganizationSettings(
      { organizationId, timezone: 'America/Chicago' },
      { userId: ownerId, authorization: ownerContext },
      { gateway: repository },
    );

    expect(repository.updateSettings).toHaveBeenCalledWith({
      organizationId,
      timezone: 'America/Chicago',
    });
  });

  it('rejects a timezone that is not an IANA timezone', async () => {
    const repository = gateway();
    const result = await updateOrganizationSettings(
      { organizationId, timezone: 'rink-time' },
      { userId: ownerId, authorization: ownerContext },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'invalid_input' } });
    expect(repository.updateSettings).not.toHaveBeenCalled();
  });

  it('does not permit a stale cross-organization context to mutate settings', async () => {
    const repository = gateway();
    const result = await updateOrganizationSettings(
      { organizationId, timezone: 'America/Chicago' },
      {
        userId: ownerId,
        authorization: {
          ...ownerContext,
          organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrganizationId,
        },
      },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(repository.updateSettings).not.toHaveBeenCalled();
  });
});
