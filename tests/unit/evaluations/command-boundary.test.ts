import { describe, expect, it, vi } from 'vitest';

import { completeEvaluationRecord } from '../../../src/modules/evaluations/application/complete-evaluation';
import { configureEvaluationNoteTag } from '../../../src/modules/evaluations/application/configure-evaluation-note-tag';
import { manageDirectorFlag } from '../../../src/modules/evaluations/application/manage-director-flag';
import { lockEvaluation } from '../../../src/modules/evaluations/application/lock-evaluation';
import { reopenEvaluation } from '../../../src/modules/evaluations/application/reopen-evaluation';
import { saveEvaluationDraft } from '../../../src/modules/evaluations/application/save-evaluation-draft';
import {
  mapCompleteResponse,
  mapConfigureTagResponse,
  mapDirectorFlagResponse,
  mapLockResponse,
  mapReopenResponse,
  mapSaveResponse,
} from '../../../src/modules/evaluations/infrastructure/supabase-evaluation-gateway';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  tryout: '10000000-0000-4000-8000-000000000002',
  division: '10000000-0000-4000-8000-000000000003',
  registration: '10000000-0000-4000-8000-000000000004',
  session: '10000000-0000-4000-8000-000000000005',
  group: '10000000-0000-4000-8000-000000000006',
  evaluator: '10000000-0000-4000-8000-000000000007',
  evaluation: '10000000-0000-4000-8000-000000000008',
  rubric: '10000000-0000-4000-8000-000000000009',
  category: '10000000-0000-4000-8000-000000000010',
  flag: '10000000-0000-4000-8000-000000000011',
};

const placement = {
  organizationId: ids.organization,
  tryoutId: ids.tryout,
  divisionId: ids.division,
  sessionId: ids.session,
  groupId: ids.group,
};

const evaluator: AuthorizationContext = {
  userId: ids.evaluator as AuthorizationContext['userId'],
  organizationId: ids.organization as AuthorizationContext['organizationId'],
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [
    {
      role: 'evaluator',
      scope: { kind: 'group', tryoutId: ids.tryout, sessionId: ids.session, groupId: ids.group },
    },
  ],
};

const director: AuthorizationContext = {
  ...evaluator,
  assignments: [
    {
      role: 'director',
      scope: { kind: 'group', tryoutId: ids.tryout, sessionId: ids.session, groupId: ids.group },
    },
  ],
};

const divisionEvaluator: AuthorizationContext = {
  ...evaluator,
  assignments: [
    {
      role: 'evaluator',
      scope: { kind: 'division', tryoutId: ids.tryout, divisionId: ids.division },
    },
  ],
};

describe('evaluation placement preflight', () => {
  it.each([
    ['tryoutId', '10000000-0000-4000-8000-000000000099', evaluator],
    ['divisionId', '10000000-0000-4000-8000-000000000099', divisionEvaluator],
    ['sessionId', '10000000-0000-4000-8000-000000000099', evaluator],
    ['groupId', '10000000-0000-4000-8000-000000000099', evaluator],
  ] as const)(
    'denies save before the gateway when %s is unrelated to the matching assignment scope',
    async (field, value, actor) => {
      const save = vi.fn();
      const result = await saveEvaluationDraft(
        {
          ...placement,
          [field]: value,
          registrationId: ids.registration,
          evaluatorUserId: ids.evaluator,
          rubricVersionId: ids.rubric,
          scores: [{ categoryId: ids.category, value: 4 }],
        },
        actor,
        1,
        { gateway: { save } },
      );
      expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
      expect(save).not.toHaveBeenCalled();
    },
  );

  it('passes all authoritative placement fields to completion and catches exceptions', async () => {
    const complete = vi.fn(async () => {
      throw new Error('transport');
    });
    await expect(
      completeEvaluationRecord({ ...placement, evaluationId: ids.evaluation }, evaluator, 2, {
        gateway: { complete },
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'unexpected' } });
    expect(complete).toHaveBeenCalledWith({
      ...placement,
      evaluationId: ids.evaluation,
      expectedVersion: 2,
    });
  });

  it('requires exact director placement for reopen, lock, and director flags', async () => {
    const unrelated = {
      ...director,
      assignments: [
        {
          role: 'director' as const,
          scope: {
            kind: 'group' as const,
            tryoutId: ids.tryout,
            sessionId: ids.session,
            groupId: '10000000-0000-4000-8000-000000000099',
          },
        },
      ],
    };
    const reopen = vi.fn();
    const lock = vi.fn();
    const manage = vi.fn();
    await expect(
      reopenEvaluation(
        { ...placement, evaluationId: ids.evaluation, reason: 'Reviewed with head director' },
        unrelated,
        2,
        { gateway: { reopen } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    await expect(
      lockEvaluation({ ...placement, evaluationId: ids.evaluation }, unrelated, 2, {
        gateway: { lock },
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    await expect(
      manageDirectorFlag(
        {
          ...placement,
          registrationId: ids.registration,
          flagId: null,
          action: 'upsert',
          flagType: 'needs_another_look',
        },
        unrelated,
        { gateway: { manage } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(reopen).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(manage).not.toHaveBeenCalled();
  });
});

describe('strict Supabase evaluation response mapping', () => {
  const malformed = [
    null,
    [],
    [{ outcome: 'saved', evaluation_id: null, version: 1 }],
    [{ outcome: 'mystery' }],
    [
      { outcome: 'saved', evaluation_id: ids.evaluation, version: 1 },
      { outcome: 'saved', evaluation_id: ids.evaluation, version: 1 },
    ],
  ];

  it.each(malformed)('closes malformed save rows as unexpected', (data) => {
    expect(mapSaveResponse(data, null)).toEqual({ outcome: 'unexpected' });
  });

  it('accepts only one complete success row with non-null success fields', () => {
    expect(
      mapSaveResponse([{ outcome: 'saved', evaluation_id: ids.evaluation, version: 2 }], null),
    ).toEqual({ outcome: 'saved', evaluationId: ids.evaluation, version: 2 });
  });

  it.each([mapCompleteResponse, mapReopenResponse, mapLockResponse])(
    'rejects null, multirow, unknown, and transport lifecycle responses',
    (mapper) => {
      expect(mapper(null, null)).toEqual({ outcome: 'unexpected' });
      expect(
        mapper(
          [
            { outcome: 'completed', version: 2 },
            { outcome: 'conflict', version: 2 },
          ],
          null,
        ),
      ).toEqual({ outcome: 'unexpected' });
      expect(mapper([{ outcome: 'unknown', version: null }], null)).toEqual({
        outcome: 'unexpected',
      });
      expect(mapper([{ outcome: 'conflict', version: null }], { code: 'XX000' })).toEqual({
        outcome: 'unexpected',
      });
    },
  );

  it('strictly maps nullable configuration and director-flag outcomes', () => {
    expect(mapConfigureTagResponse([{ outcome: 'forbidden', note_tag_id: null }], null)).toEqual({
      outcome: 'forbidden',
    });
    expect(mapConfigureTagResponse([{ outcome: 'saved', note_tag_id: null }], null)).toEqual({
      outcome: 'unexpected',
    });
    expect(
      mapDirectorFlagResponse([{ outcome: 'revoked', athlete_flag_id: ids.flag }], null),
    ).toEqual({ outcome: 'revoked', athleteFlagId: ids.flag });
    expect(mapDirectorFlagResponse([{ outcome: 'saved', athlete_flag_id: null }], null)).toEqual({
      outcome: 'unexpected',
    });
  });
});

describe('organization tag configuration boundary', () => {
  it('maps a gateway exception to unexpected', async () => {
    await expect(
      configureEvaluationNoteTag(
        {
          organizationId: ids.organization,
          noteTagId: null,
          label: 'High motor',
          active: true,
        },
        { ...director, organizationRole: 'owner' },
        { gateway: { configure: async () => Promise.reject(new Error('network')) } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'unexpected' } });
  });
});
