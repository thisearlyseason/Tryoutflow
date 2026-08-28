import { describe, expect, it } from 'vitest';

import { requireCapability } from '../../../src/modules/organizations/application/require-capability';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { OrganizationId, UserId } from '../../../src/lib/ids';

const organizationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const organizationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrganizationId;
const ownerA = '11111111-1111-4111-8111-111111111111' as UserId;

describe('organization authorization boundary', () => {
  it('returns a permission result instead of allowing a cross-tenant direct object reference', () => {
    const context: AuthorizationContext = {
      userId: ownerA,
      organizationId: organizationA,
      organizationRole: 'owner',
      assignments: [],
    };

    expect(requireCapability(context, 'athlete:read', { organizationId: organizationB })).toEqual({
      ok: false,
      error: { code: 'forbidden' },
    });
  });
});
