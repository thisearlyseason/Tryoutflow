import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@/infrastructure/supabase/database.types';
import { parseOrganizationId, parseUserId } from '@/lib/ids';
import type { AuthorizationContext } from '@/modules/organizations/application/capabilities';
import { organizationRoutePreflight } from '@/modules/organizations/application/organization-route-preflight';

const membership = vi.hoisted(() => vi.fn());
vi.mock('@/modules/organizations/infrastructure/membership-repository', () => ({
  SupabaseMembershipRepository: class {
    findAuthorizationContext = membership;
  },
}));
const organizationId = parseOrganizationId('11111111-1111-4111-8111-111111111111');
const userId = parseUserId('22222222-2222-4222-8222-222222222222');
const tryoutId = '33333333-3333-4333-8333-333333333333';
const divisionId = '44444444-4444-4444-8444-444444444444';
const sessionId = '55555555-5555-4555-8555-555555555555';
const groupId = '66666666-6666-4666-8666-666666666666';
let authorization: AuthorizationContext;
let records: Record<string, { data: unknown; error: null | Error }>;
function client() {
  return {
    from: vi.fn((table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: () => Promise.resolve(records[table]),
        then: (resolve: (value: unknown) => void) => Promise.resolve(records[table]).then(resolve),
      };
      return chain;
    }),
  } as unknown as SupabaseClient<Database>;
}
const check = (path: string) =>
  organizationRoutePreflight(client(), userId, new URL(`https://www.tryout.agency${path}`));
const eventPath = (suffix: string) => `/app/hockey/tryouts/${tryoutId}/${suffix}`;
beforeEach(() => {
  authorization = {
    organizationId,
    userId,
    organizationRole: 'member',
    membershipStatus: 'active',
    assignments: [],
  };
  membership.mockReset().mockImplementation(async () => authorization);
  records = {
    organizations: { data: { id: organizationId }, error: null },
    tryout_divisions: { data: [{ id: divisionId }], error: null },
    roster_versions: { data: [{ division_id: divisionId, state: 'draft' }], error: null },
    tryout_sessions: {
      data: [{ id: sessionId, division_id: divisionId, session_groups: [{ id: groupId }] }],
      error: null,
    },
  };
});
describe('deny documents before streaming without changing capability rules', () => {
  it('leaves non-organization routes to their existing boundary', async () => {
    expect(await check('/app')).toBe(true);
    expect(membership).not.toHaveBeenCalled();
  });
  it('denies missing organizations and inactive/missing membership', async () => {
    records.organizations!.data = null;
    expect(await check('/app/hockey/home')).toBe(false);
    records.organizations!.data = { id: organizationId };
    membership.mockResolvedValue(null);
    expect(await check('/app/hockey/home')).toBe(false);
  });
  it('preserves data failures rather than disguising them as success', async () => {
    records.organizations!.error = new Error('database unavailable');
    await expect(check('/app/hockey/home')).rejects.toThrow('database unavailable');
  });
  it('denies malformed identifiers', async () => {
    expect(await check('/app/%E0/home')).toBe(false);
    expect(await check('/app/hockey/tryouts/not-a-uuid/check-in')).toBe(false);
    expect(await check(eventPath('rosters?division=bad'))).toBe(false);
  });
  it('permits member shell access but denies audit data', async () => {
    expect(await check('/app/hockey/home')).toBe(true);
    expect(await check('/app/hockey/organization/audit')).toBe(false);
    authorization.organizationRole = 'owner';
    expect(await check('/app/hockey/organization/audit')).toBe(true);
  });
  it('keeps roster writer selection and division scope exact', async () => {
    authorization.assignments = [
      { role: 'director', scope: { kind: 'division', tryoutId, divisionId } },
    ];
    expect(await check(eventPath('rosters'))).toBe(true);
    authorization.assignments = [{ role: 'checkin', scope: { kind: 'tryout', tryoutId } }];
    expect(await check(eventPath(`rosters?division=${divisionId}`))).toBe(false);
  });
  it('permits reviewer finalized rosters only, using latest revision', async () => {
    authorization.assignments = [{ role: 'reviewer', scope: { kind: 'tryout', tryoutId } }];
    expect(await check(eventPath('rosters'))).toBe(false);
    records.roster_versions!.data = [{ division_id: divisionId, state: 'finalized' }];
    expect(await check(eventPath('rosters'))).toBe(true);
    records.roster_versions!.data = [
      { division_id: divisionId, state: 'draft' },
      { division_id: divisionId, state: 'finalized' },
    ];
    expect(await check(eventPath('rosters'))).toBe(false);
  });
  it('denies nonexistent selected divisions even for owners', async () => {
    authorization.organizationRole = 'owner';
    expect(await check(eventPath(`rosters?division=${groupId}`))).toBe(false);
  });
  it('keeps group placement scope exact and denies ordinary members', async () => {
    expect(await check(eventPath('check-in'))).toBe(false);
    authorization.assignments = [
      { role: 'checkin', scope: { kind: 'group', tryoutId, sessionId, groupId } },
    ];
    expect(await check(eventPath('check-in'))).toBe(true);
    authorization.assignments = [
      { role: 'checkin', scope: { kind: 'group', tryoutId, sessionId, groupId: divisionId } },
    ];
    expect(await check(eventPath('check-in'))).toBe(false);
  });
  it('preserves authorized empty-configuration UI', async () => {
    records.tryout_sessions!.data = [];
    expect(await check(eventPath('check-in'))).toBe(false);
    authorization.organizationRole = 'owner';
    expect(await check(eventPath('check-in'))).toBe(true);
  });
});
