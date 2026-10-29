import { expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/infrastructure/supabase/database.types';
import type { OrganizationId, UserId } from '@/lib/ids';
import { SupabaseMembershipRepository } from '@/modules/organizations/infrastructure/membership-repository';
const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const member = {
  organization_id: organizationId,
  user_id: userId,
  role: 'member',
  status: 'active',
};
const assignment = {
  role: 'evaluator',
  scope_kind: 'tryout',
  tryout_id: 'tryout-1',
  revoked_at: null,
  expires_at: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function clientFor(membership: () => unknown, assignments: () => unknown) {
  const calls: Array<{ table: string; filters: unknown[][] }> = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as unknown[][] };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          call.filters.push(['eq', ...args]);
          return chain;
        },
        maybeSingle: () => membership(),
        is: (...args: unknown[]) => {
          call.filters.push(['is', ...args]);
          return assignments();
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}
it('starts both network reads before either response and waits for complete authority', async () => {
  const membership = deferred<unknown>(),
    assignments = deferred<unknown>();
  let membershipStarted = false,
    assignmentsStarted = false,
    completed = false;
  const { client, calls } = clientFor(
    () => {
      membershipStarted = true;
      return membership.promise;
    },
    () => {
      assignmentsStarted = true;
      return assignments.promise;
    },
  );
  const pending = new SupabaseMembershipRepository(client)
    .findAuthorizationContext(userId, organizationId)
    .then((value) => {
      completed = true;
      return value;
    });
  expect(membershipStarted).toBe(true);
  expect(assignmentsStarted).toBe(true);
  membership.resolve({ data: member, error: null });
  await Promise.resolve();
  expect(completed).toBe(false);
  assignments.resolve({ data: [assignment], error: null });
  expect((await pending)?.assignments).toEqual([
    { role: 'evaluator', scope: { kind: 'tryout', tryoutId: 'tryout-1' } },
  ]);
  for (const call of calls) {
    expect(call.filters).toContainEqual(['eq', 'organization_id', organizationId]);
    expect(call.filters).toContainEqual(['eq', 'user_id', userId]);
  }
  expect(calls.find((x) => x.table === 'tryout_staff_assignments')!.filters).toContainEqual([
    'is',
    'revoked_at',
    null,
  ]);
});
it.each([null, { ...member, status: 'disabled' }, { ...member, role: 'unknown' }])(
  'cannot authorize denied membership even if own assignments exist: %j',
  async (data) => {
    const { client } = clientFor(
      () => ({ data, error: null }),
      () => ({ data: [assignment], error: null }),
    );
    expect(
      await new SupabaseMembershipRepository(client).findAuthorizationContext(
        userId,
        organizationId,
      ),
    ).toBeNull();
  },
);
it('reads membership and assignments again after role revocation instead of caching authority', async () => {
  let data = { ...member };
  const { client, calls } = clientFor(
    () => ({ data, error: null }),
    () => ({ data: [assignment], error: null }),
  );
  const repository = new SupabaseMembershipRepository(client);
  expect(await repository.findAuthorizationContext(userId, organizationId)).not.toBeNull();
  data = { ...member, status: 'disabled' };
  expect(await repository.findAuthorizationContext(userId, organizationId)).toBeNull();
  expect(calls.filter((x) => x.table === 'organization_members')).toHaveLength(2);
  expect(calls.filter((x) => x.table === 'tryout_staff_assignments')).toHaveLength(2);
});
it.each(['membership', 'assignments'])('fails closed when the %s read fails', async (failed) => {
  const failure = new Error('unavailable');
  const { client } = clientFor(
    () => ({ data: member, error: failed === 'membership' ? failure : null }),
    () => ({ data: [], error: failed === 'assignments' ? failure : null }),
  );
  await expect(
    new SupabaseMembershipRepository(client).findAuthorizationContext(userId, organizationId),
  ).rejects.toBe(failure);
});
