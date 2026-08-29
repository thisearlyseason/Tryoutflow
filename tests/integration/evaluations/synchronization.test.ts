// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { syncEvaluationMutation } from '../../../src/modules/evaluations/application/sync-evaluation-mutation';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const ids = {
  organizationId: '71000000-0000-4000-8000-000000000001',
  tryoutId: '71000000-0000-4000-8000-000000000002',
  sessionId: '71000000-0000-4000-8000-000000000003',
  registrationId: '71000000-0000-4000-8000-000000000004',
  rubricVersionId: '71000000-0000-4000-8000-000000000005',
  evaluatorId: '71000000-0000-4000-8000-000000000006',
  evaluationId: '71000000-0000-4000-8000-000000000007',
  categoryId: '71000000-0000-4000-8000-000000000008',
  clientMutationId: '71000000-0000-4000-8000-000000000009',
} as const;

const actor: AuthorizationContext = {
  userId: ids.evaluatorId as AuthorizationContext['userId'],
  organizationId: ids.organizationId as AuthorizationContext['organizationId'],
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [
    {
      role: 'evaluator',
      scope: { kind: 'session', tryoutId: ids.tryoutId, sessionId: ids.sessionId },
    },
  ],
};

const mutation = {
  scope: {
    userId: ids.evaluatorId,
    evaluatorId: ids.evaluatorId,
    organizationId: ids.organizationId,
    tryoutId: ids.tryoutId,
    sessionId: ids.sessionId,
    registrationId: ids.registrationId,
    rubricVersionId: ids.rubricVersionId,
  },
  evaluationId: ids.evaluationId,
  clientMutationId: ids.clientMutationId,
  expectedVersion: 0,
  draft: {
    scores: [{ categoryId: ids.categoryId, value: 4 }],
    noteTagIds: [],
    flags: [],
  },
};

describe('evaluation synchronization command', () => {
  it('returns the immutable server receipt without weakening evaluator scope', async () => {
    const receipt = {
      outcome: 'synced' as const,
      clientMutationId: ids.clientMutationId,
      evaluationId: ids.evaluationId,
      expectedVersion: 0,
      serverVersion: 1,
      payloadDigest: 'a'.repeat(64),
      acknowledgedAt: '2026-08-29T12:00:00.000Z',
    };
    const result = await syncEvaluationMutation(mutation, actor, {
      gateway: { sync: async () => receipt },
    });
    expect(result).toEqual({ ok: true, value: receipt });
  });

  it('fails closed when device user/evaluator scope does not equal the actor', async () => {
    let called = false;
    const result = await syncEvaluationMutation(
      { ...mutation, scope: { ...mutation.scope, evaluatorId: crypto.randomUUID() } },
      actor,
      { gateway: { sync: async () => ((called = true), {} as never) } },
    );
    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(called).toBe(false);
  });
});
