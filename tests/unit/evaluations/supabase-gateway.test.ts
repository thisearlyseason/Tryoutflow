import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const createServerSupabaseClient = vi.hoisted(() => vi.fn(async () => ({ rpc })));

vi.mock('../../../src/infrastructure/supabase/server', () => ({ createServerSupabaseClient }));

import { saveEvaluationDraft } from '../../../src/modules/evaluations/application/save-evaluation-draft';
import { SupabaseEvaluationGateway } from '../../../src/modules/evaluations/infrastructure/supabase-evaluation-gateway';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const placement = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  tryoutId: '10000000-0000-4000-8000-000000000002',
  divisionId: '10000000-0000-4000-8000-000000000003',
  registrationId: '10000000-0000-4000-8000-000000000004',
  sessionId: '10000000-0000-4000-8000-000000000005',
  groupId: null,
};
const evaluatorId = '10000000-0000-4000-8000-000000000006';
const evaluationId = '10000000-0000-4000-8000-000000000007';
const rubricVersionId = '10000000-0000-4000-8000-000000000008';
const categoryId = '10000000-0000-4000-8000-000000000009';
const actor: AuthorizationContext = {
  userId: evaluatorId as AuthorizationContext['userId'],
  organizationId: placement.organizationId as AuthorizationContext['organizationId'],
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [
    {
      role: 'evaluator',
      scope: { kind: 'session', tryoutId: placement.tryoutId, sessionId: placement.sessionId },
    },
  ],
};

describe('Supabase evaluation production gateway', () => {
  beforeEach(() => {
    rpc.mockReset();
    createServerSupabaseClient.mockClear();
  });

  it('lets the production save command construct its server gateway when none is injected', async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: 'saved', evaluation_id: evaluationId, version: 1 }],
      error: null,
    });
    await expect(
      saveEvaluationDraft(
        {
          ...placement,
          evaluatorUserId: evaluatorId,
          rubricVersionId,
          scores: [{ categoryId, value: 4 }],
        },
        actor,
        0,
      ),
    ).resolves.toEqual({ ok: true, value: { evaluationId, version: 1 } });
    expect(createServerSupabaseClient).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      'save_evaluation_draft',
      expect.objectContaining({
        p_division_id: placement.divisionId,
        p_group_id: null,
        p_registration_id: placement.registrationId,
        p_session_id: placement.sessionId,
        p_tryout_id: placement.tryoutId,
      }),
    );
  });

  it('provides concrete RPC methods for every evaluation command', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ outcome: 'completed', version: 2 }], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: 'reopened', version: 3 }], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: 'locked', version: 4 }], error: null })
      .mockResolvedValueOnce({
        data: [{ outcome: 'saved', note_tag_id: categoryId }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: 'saved', athlete_flag_id: evaluationId }],
        error: null,
      });
    const gateway = new SupabaseEvaluationGateway({ rpc } as never);
    await gateway.complete({ ...placement, evaluationId, expectedVersion: 1 });
    await gateway.reopen({
      ...placement,
      evaluationId,
      expectedVersion: 2,
      reason: 'Reviewed by director',
    });
    await gateway.lock({ ...placement, evaluationId, expectedVersion: 3 });
    await gateway.configure({
      organizationId: placement.organizationId,
      noteTagId: null,
      label: 'High motor',
      active: true,
    });
    await gateway.manage({
      ...placement,
      flagId: null,
      action: 'upsert',
      flagType: 'needs_another_look',
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'complete_evaluation',
      'reopen_evaluation',
      'lock_evaluation',
      'configure_evaluation_note_tag',
      'manage_director_evaluation_flag',
    ]);
  });
});
