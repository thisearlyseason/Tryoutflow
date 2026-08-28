import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import {
  mapPublishRubricVersionResponse,
  publishRubricVersion,
} from '../../../src/modules/rubrics/application/publish-rubric-version';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const ownerId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const rubricId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ownerAuthorization: AuthorizationContext = {
  userId: ownerId,
  organizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

describe('rubric version publishing', () => {
  it('publishes a draft through one atomic persistence command', async () => {
    const publish = vi.fn(async () => ({ kind: 'published' as const, versionId: 'version-1' }));

    const result = await publishRubricVersion(
      { organizationId, tryoutId, rubricId, expectedVersion: 1 },
      { authorization: ownerAuthorization },
      { gateway: { publish } },
    );

    expect(result).toEqual({ ok: true, value: { versionId: 'version-1' } });
    expect(publish).toHaveBeenCalledWith({ organizationId, rubricId, expectedVersion: 1 });
  });

  it('does not call persistence for a stale tenant authorization', async () => {
    const publish = vi.fn(async () => ({ kind: 'published' as const, versionId: 'version-1' }));

    const result = await publishRubricVersion(
      { organizationId, tryoutId, rubricId, expectedVersion: 1 },
      {
        authorization: {
          ...ownerAuthorization,
          organizationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as OrganizationId,
        },
      },
      { gateway: { publish } },
    );

    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns a race-safe conflict from the persistence command', async () => {
    const result = await publishRubricVersion(
      { organizationId, tryoutId, rubricId, expectedVersion: 1 },
      { authorization: ownerAuthorization },
      { gateway: { publish: async () => ({ kind: 'conflict' }) } },
    );

    expect(result).toEqual({ ok: false, error: { code: 'conflict' } });
  });

  it('maps PostgreSQL authorization failures and malformed RPC responses safely', () => {
    expect(mapPublishRubricVersionResponse(null, { code: '42501' })).toEqual({ kind: 'forbidden' });
    expect(
      mapPublishRubricVersionResponse([{ outcome: 'capacity', version_id: null }], null),
    ).toEqual({
      kind: 'capacity',
    });
    expect(
      mapPublishRubricVersionResponse([{ outcome: 'published', version_id: null }], null),
    ).toEqual({
      kind: 'unexpected',
    });
    expect(
      mapPublishRubricVersionResponse([{ outcome: 'unknown', version_id: 'version-1' }], null),
    ).toEqual({
      kind: 'unexpected',
    });
  });
});
