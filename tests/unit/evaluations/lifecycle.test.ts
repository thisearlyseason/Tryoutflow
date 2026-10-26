import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../../src/lib/clock';
import {
  completeEvaluation,
  type EvaluationDraft,
} from '../../../src/modules/evaluations/domain/evaluation';
import { validateSelectedNoteTags } from '../../../src/modules/evaluations/domain/note-tags';
import { saveEvaluationDraft } from '../../../src/modules/evaluations/application/save-evaluation-draft';
import { reopenEvaluation } from '../../../src/modules/evaluations/application/reopen-evaluation';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  tryout: '10000000-0000-4000-8000-000000000002',
  registration: '10000000-0000-4000-8000-000000000003',
  session: '10000000-0000-4000-8000-000000000004',
  division: '10000000-0000-4000-8000-000000000010',
  group: '10000000-0000-4000-8000-000000000011',
  evaluatorA: '10000000-0000-4000-8000-000000000005',
  evaluatorB: '10000000-0000-4000-8000-000000000006',
  category: '10000000-0000-4000-8000-000000000007',
  rubricVersion: '10000000-0000-4000-8000-000000000008',
};

const incompleteDraft: EvaluationDraft = {
  id: '10000000-0000-4000-8000-000000000009',
  state: 'draft',
  version: 1,
  scores: [],
  categories: [{ id: ids.category, required: true, scaleMin: 1, scaleMax: 5 }],
};

function evaluator(userId: string): AuthorizationContext {
  return {
    userId: userId as AuthorizationContext['userId'],
    organizationId: ids.organization as AuthorizationContext['organizationId'],
    organizationRole: 'member',
    membershipStatus: 'active',
    assignments: [
      {
        role: 'evaluator',
        scope: {
          kind: 'group',
          tryoutId: ids.tryout,
          sessionId: ids.session,
          groupId: ids.group,
        },
      },
    ],
  };
}

describe('evaluation lifecycle', () => {
  it('refuses completion while a required score is missing', () => {
    expect(
      completeEvaluation(incompleteDraft, new FixedClock(new Date('2026-08-29T12:00:00Z'))),
    ).toEqual({
      ok: false,
      error: { code: 'required_scores_missing' },
    });
  });

  it('completes atomically with valid exact-category scores and increments the version', () => {
    expect(
      completeEvaluation(
        { ...incompleteDraft, scores: [{ categoryId: ids.category, value: 5 }] },
        new FixedClock(new Date('2026-08-29T12:00:00Z')),
      ),
    ).toEqual({
      ok: true,
      value: {
        state: 'completed',
        version: 2,
        completedAt: '2026-08-29T12:00:00.000Z',
      },
    });
  });

  it('rejects a score for a category outside the immutable rubric version', () => {
    expect(
      completeEvaluation(
        {
          ...incompleteDraft,
          scores: [{ categoryId: '10000000-0000-4000-8000-000000000099', value: 4 }],
        },
        new FixedClock(new Date('2026-08-29T12:00:00Z')),
      ),
    ).toEqual({ ok: false, error: { code: 'invalid_score' } });
  });

  it('rejects unconfigured note tags and duplicate configured tags', () => {
    const configured = [
      { id: '20000000-0000-4000-8000-000000000001', label: 'Needs another look', active: true },
    ];
    expect(validateSelectedNoteTags(configured, ['20000000-0000-4000-8000-000000000099'])).toEqual({
      ok: false,
      error: { code: 'invalid_note_tag' },
    });
    expect(
      validateSelectedNoteTags(configured, [
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
      ]),
    ).toEqual({ ok: false, error: { code: 'duplicate_note_tag' } });
  });

  it('never allows evaluator B to save evaluator A record', async () => {
    let called = false;
    const result = await saveEvaluationDraft(
      {
        organizationId: ids.organization,
        tryoutId: ids.tryout,
        registrationId: ids.registration,
        divisionId: ids.division,
        sessionId: ids.session,
        groupId: ids.group,
        evaluatorUserId: ids.evaluatorA,
        rubricVersionId: ids.rubricVersion,
        scores: [{ categoryId: ids.category, value: 4 }],
      },
      evaluator(ids.evaluatorB),
      1,
      {
        gateway: {
          save: async () => (
            (called = true),
            { outcome: 'saved', evaluationId: incompleteDraft.id, version: 2 }
          ),
        },
      },
    );
    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(called).toBe(false);
  });

  it('requires a bounded reason and director authority to reopen', async () => {
    const gateway = { reopen: async () => ({ outcome: 'reopened' as const, version: 3 }) };
    await expect(
      reopenEvaluation(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          sessionId: ids.session,
          groupId: ids.group,
          evaluationId: incompleteDraft.id,
          reason: 'short',
        },
        evaluator(ids.evaluatorA),
        2,
        { gateway },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_reason' } });
  });
});
