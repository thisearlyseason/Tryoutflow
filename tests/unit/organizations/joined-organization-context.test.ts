import { expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/infrastructure/supabase/database.types';
import type { UserId } from '@/lib/ids';
import { SupabaseMembershipRepository } from '@/modules/organizations/infrastructure/membership-repository';

const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const membership = { organization_id: orgId, user_id: userId, role: 'member', status: 'active' };
const assignment = {
  role: 'evaluator',
  scope_kind: 'tryout',
  tryout_id: 'tryout-1',
  division_id: null,
  session_id: null,
  group_id: null,
  athlete_id: null,
  revoked_at: null,
  expires_at: null,
};
const organization = {
  id: orgId,
  name: 'Fictional QA',
  slug: 'fictional-qa',
  timezone: 'UTC',
  terminology: {},
  sport_defaults: [],
  tag_defaults: [],
};
function repository(response: () => unknown) {
  const calls: unknown[][] = [];
  const query = {
    select: (...args: unknown[]) => {
      calls.push(['select', ...args]);
      return query;
    },
    eq: (...args: unknown[]) => {
      calls.push(['eq', ...args]);
      return query;
    },
    is: (...args: unknown[]) => {
      calls.push(['is', ...args]);
      return query;
    },
    maybeSingle: async () => response(),
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return query;
    },
  } as unknown as SupabaseClient<Database>;
  return { repo: new SupabaseMembershipRepository(client), calls };
}
it('resolves the same scoped authority with one request and explicit own-user filters on both relations', async () => {
  const { repo, calls } = repository(() => ({
    data: { ...organization, members: [membership], assignments: [assignment] },
    error: null,
  }));
  const result = await repo.findOrganizationContext(userId, organization.slug);
  expect(calls.filter(([operation]) => operation === 'from')).toEqual([['from', 'organizations']]);
  expect(calls).toContainEqual(['eq', 'slug', organization.slug]);
  expect(calls).toContainEqual(['eq', 'members.user_id', userId]);
  expect(calls).toContainEqual(['eq', 'assignments.user_id', userId]);
  expect(calls).toContainEqual(['is', 'assignments.revoked_at', null]);
  expect(result?.authorization.assignments).toEqual([
    { role: 'evaluator', scope: { kind: 'tryout', tryoutId: 'tryout-1' } },
  ]);
  expect(result?.organization).toEqual(organization);
  expect(result?.organization).not.toHaveProperty('members');
  expect(result?.organization).not.toHaveProperty('assignments');
});
it.each(
  [
    [],
    [{ ...membership, status: 'disabled' }],
    [{ ...membership, role: 'unknown' }],
    [{ ...membership, user_id: 'different-user' }],
    [{ ...membership, organization_id: 'different-org' }],
    [membership, membership],
  ].map((members) => ({ members })),
)(
  'denies missing, inactive, unrecognized or mismatched membership, even with assignments',
  async ({ members }) => {
    const { repo } = repository(() => ({
      data: { ...organization, members, assignments: [assignment] },
      error: null,
    }));
    expect(await repo.findOrganizationContext(userId, organization.slug)).toBeNull();
  },
);
it('preserves assignment expiry, revocation and malformed-scope checks', async () => {
  const { repo } = repository(() => ({
    data: {
      ...organization,
      members: [membership],
      assignments: [
        assignment,
        { ...assignment, revoked_at: '2026-10-28T00:00:00Z' },
        { ...assignment, expires_at: '2026-10-28T00:00:00Z' },
        { ...assignment, division_id: 'unexpected-division' },
        { ...assignment, role: 'unknown' },
      ],
    },
    error: null,
  }));
  const result = await repo.findOrganizationContext(
    userId,
    organization.slug,
    new Date('2026-10-29T00:00:00Z'),
  );
  expect(result?.authorization.assignments).toHaveLength(1);
});
it('checks membership freshly after revocation on a subsequent request', async () => {
  let active = true;
  const { repo } = repository(() => ({
    data: { ...organization, members: active ? [membership] : [], assignments: [assignment] },
    error: null,
  }));
  expect(await repo.findOrganizationContext(userId, organization.slug)).not.toBeNull();
  active = false;
  expect(await repo.findOrganizationContext(userId, organization.slug)).toBeNull();
});
it('denies a missing organization and propagates query failure rather than falling back to cached authority', async () => {
  const missing = repository(() => ({ data: null, error: null }));
  expect(await missing.repo.findOrganizationContext(userId, organization.slug)).toBeNull();
  const failed = repository(() => ({ data: null, error: new Error('query failed') }));
  await expect(failed.repo.findOrganizationContext(userId, organization.slug)).rejects.toThrow(
    'query failed',
  );
});
