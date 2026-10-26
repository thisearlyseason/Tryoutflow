import { describe, expect, it } from 'vitest';

import { buildAuthorizationContext } from '../../../src/modules/organizations/infrastructure/membership-repository';
import type { OrganizationId, UserId } from '../../../src/lib/ids';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;

describe('buildAuthorizationContext', () => {
  it('keeps only active, unexpired scoped assignments for the current member', () => {
    const context = buildAuthorizationContext(
      { organizationId, userId, role: 'member', status: 'active' },
      [
        {
          role: 'evaluator',
          scopeKind: 'tryout',
          tryoutId: 'tryout-1',
          revokedAt: null,
          expiresAt: null,
        },
        {
          role: 'checkin',
          scopeKind: 'tryout',
          tryoutId: 'tryout-1',
          revokedAt: '2026-08-28T00:00:00Z',
          expiresAt: null,
        },
        {
          role: 'reviewer',
          scopeKind: 'tryout',
          tryoutId: 'tryout-1',
          revokedAt: null,
          expiresAt: '2026-08-27T00:00:00Z',
        },
      ],
      new Date('2026-08-28T00:00:00Z'),
    );

    expect(context).toEqual({
      userId,
      organizationId,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [{ role: 'evaluator', scope: { kind: 'tryout', tryoutId: 'tryout-1' } }],
    });
  });

  it('returns null for an inactive membership', () => {
    expect(
      buildAuthorizationContext(
        { organizationId, userId, role: 'member', status: 'disabled' },
        [],
        new Date('2026-08-28T00:00:00Z'),
      ),
    ).toBeNull();
  });

  it('drops malformed assignments rather than treating a missing tryout scope as a wildcard', () => {
    const context = buildAuthorizationContext(
      { organizationId, userId, role: 'member', status: 'active' },
      [
        {
          role: 'evaluator',
          scopeKind: 'division',
          tryoutId: '',
          divisionId: 'division-1',
          revokedAt: null,
          expiresAt: null,
        },
      ],
      new Date('2026-08-28T00:00:00Z'),
    );

    expect(context?.assignments).toEqual([]);
  });
});
