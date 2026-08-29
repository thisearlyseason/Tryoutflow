import { describe, expect, it } from 'vitest';

import { compareAthletes } from '../../../src/modules/rankings/application/compare-athletes';
import {
  listRankings,
  type RankingSnapshot,
} from '../../../src/modules/rankings/application/list-rankings';
import { parseRankingSnapshot } from '../../../src/modules/rankings/infrastructure/supabase-ranking-gateway';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { parseOrganizationId, parseUserId } from '../../../src/lib/ids';
import {
  getLiveDashboard,
  parseLiveDashboardResponse,
} from '../../../src/modules/tryouts/application/get-live-dashboard';

const organizationId = '11111111-1111-4111-8111-111111111111';
const tryoutId = '22222222-2222-4222-8222-222222222222';
const divisionId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const categoryId = '55555555-5555-4555-8555-555555555555';
const actor: AuthorizationContext = {
  userId: parseUserId('66666666-6666-4666-8666-666666666666'),
  organizationId: parseOrganizationId(organizationId),
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

const snapshot: RankingSnapshot = {
  registrations: [
    {
      registrationId: '77777777-7777-4777-8777-777777777777',
      athleteId: '88888888-8888-4888-8888-888888888888',
      displayName: 'Alex Athlete',
      divisionId,
      divisionName: 'U15',
      positionId: null,
      positionName: null,
      tryoutNumber: 12,
      expectedEvaluators: 2,
      evaluations: [
        {
          evaluationId: '99999999-9999-4999-8999-999999999991',
          evaluatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          divisionId,
          sessionId,
          state: 'completed',
          assignmentState: 'active',
          categories: [
            {
              categoryId,
              categoryName: 'Skating',
              score: 4,
              scaleMax: 5,
              weight: '100.00',
              isPriority: true,
            },
          ],
        },
        {
          evaluationId: '99999999-9999-4999-8999-999999999992',
          evaluatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
          divisionId,
          sessionId,
          state: 'locked',
          assignmentState: 'active',
          categories: [
            {
              categoryId,
              categoryName: 'Skating',
              score: 5,
              scaleMax: 5,
              weight: '100.00',
              isPriority: true,
            },
          ],
        },
      ],
      categoryNames: [{ id: categoryId, name: 'Skating', scaleMax: 5 }],
      sessions: [{ id: sessionId, name: 'Skills' }],
      groups: [],
      flags: ['needs_another_look'],
    },
    {
      registrationId: '77777777-7777-4777-8777-777777777778',
      athleteId: '88888888-8888-4888-8888-888888888889',
      displayName: 'Blair Athlete',
      divisionId,
      divisionName: 'U15',
      positionId: null,
      positionName: null,
      tryoutNumber: 14,
      expectedEvaluators: 2,
      evaluations: [
        {
          evaluationId: '99999999-9999-4999-8999-999999999993',
          evaluatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
          divisionId,
          sessionId,
          state: 'completed',
          assignmentState: 'active',
          categories: [
            {
              categoryId,
              categoryName: 'Skating',
              score: 4,
              scaleMax: 5,
              weight: '100.00',
              isPriority: true,
            },
          ],
        },
        {
          evaluationId: '99999999-9999-4999-8999-999999999994',
          evaluatorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
          divisionId,
          sessionId,
          state: 'completed',
          assignmentState: 'active',
          categories: [
            {
              categoryId,
              categoryName: 'Skating',
              score: 5,
              scaleMax: 5,
              weight: '100.00',
              isPriority: true,
            },
          ],
        },
      ],
      categoryNames: [{ id: categoryId, name: 'Skating', scaleMax: 5 }],
      sessions: [{ id: sessionId, name: 'Skills' }],
      groups: [],
      flags: [],
    },
  ],
  generatedAt: '2026-08-29T12:00:00.000Z',
};

describe('authorized rankings application', () => {
  it('uses canonical values for a competition tie and exposes truthful completion context', async () => {
    const result = await listRankings({ organizationId, tryoutId, page: 1, pageSize: 25 }, actor, {
      load: async () => ({ outcome: 'ok', snapshot }),
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.rows.map((row) => row.rank)).toEqual([1, 1]);
    expect(result.value.rows[0]).toMatchObject({
      overall: '90.0',
      completedEvaluators: 2,
      expectedEvaluators: 2,
      completionPercent: 100,
      scoreRange: ['80.0', '100.0'],
      isTied: true,
    });
  });

  it('keeps zero-completion athletes unranked and applies completion/search pagination deterministically', async () => {
    const empty: RankingSnapshot = {
      ...snapshot,
      registrations: [
        ...snapshot.registrations,
        {
          ...snapshot.registrations[0]!,
          registrationId: '77777777-7777-4777-8777-777777777779',
          athleteId: '88888888-8888-4888-8888-888888888880',
          displayName: 'Casey Unscored',
          tryoutNumber: 15,
          expectedEvaluators: 2,
          evaluations: [],
        },
      ],
    };
    const result = await listRankings(
      {
        organizationId,
        tryoutId,
        completion: 'unscored',
        search: 'casey',
        page: 1,
        pageSize: 1,
      },
      actor,
      { load: async () => ({ outcome: 'ok', snapshot: empty }) },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        total: 1,
        page: 1,
        rows: [
          {
            rank: null,
            overall: null,
            completedEvaluators: 0,
            expectedEvaluators: 2,
            completionPercent: 0,
            scoreRange: null,
          },
        ],
      },
    });
  });

  it('orders by canonical rank before stable technical order', async () => {
    const lowerFirst: RankingSnapshot = {
      ...snapshot,
      registrations: snapshot.registrations.map((row, index) =>
        index === 0
          ? {
              ...row,
              evaluations: row.evaluations.map((evaluation) => ({
                ...evaluation,
                categories: evaluation.categories.map((category) => ({ ...category, score: 4 })),
              })),
            }
          : row,
      ),
    };
    const result = await listRankings({ organizationId, tryoutId }, actor, {
      load: async () => ({ outcome: 'ok', snapshot: lowerFirst }),
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.rows.map((row) => [row.displayName, row.rank])).toEqual([
      ['Blair Athlete', 1],
      ['Alex Athlete', 2],
    ]);
  });

  it('uses priority evidence only when every included rubric names the same category', async () => {
    const otherPriority = '55555555-5555-4555-8555-555555555556';
    const mixed: RankingSnapshot = {
      ...snapshot,
      registrations: snapshot.registrations.map((row, rowIndex) =>
        rowIndex === 1
          ? {
              ...row,
              evaluations: row.evaluations.map((evaluation) => ({
                ...evaluation,
                categories: evaluation.categories.map((category) => ({
                  ...category,
                  categoryId: otherPriority,
                })),
              })),
            }
          : row,
      ),
    };
    const result = await listRankings({ organizationId, tryoutId }, actor, {
      load: async () => ({ outcome: 'ok', snapshot: mixed }),
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.rows.map((row) => row.priorityCategoryId)).toEqual([null, null]);
  });

  it('fails closed for an evaluator before loading score data', async () => {
    let called = false;
    const result = await listRankings(
      { organizationId, tryoutId },
      {
        ...actor,
        organizationRole: 'member',
        assignments: [
          {
            role: 'evaluator',
            scope: { kind: 'tryout', tryoutId },
          },
        ],
      },
      {
        load: async () => {
          called = true;
          return { outcome: 'ok', snapshot };
        },
      },
    );
    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(called).toBe(false);
  });

  it('compares two to four same-tryout athletes without exposing evaluator notes or identities', async () => {
    const result = await compareAthletes(
      {
        organizationId,
        tryoutId,
        athleteIds: snapshot.registrations.map((row) => row.athleteId),
      },
      actor,
      { load: async () => ({ outcome: 'ok', snapshot }) },
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.athletes[0]).toMatchObject({ overall: '90.0' });
    expect(JSON.stringify(result)).not.toMatch(/note|evaluatorId|guardian|responses/i);
  });

  it('strictly rejects malformed database projections and unknown private fields', () => {
    expect(() =>
      parseRankingSnapshot({
        outcome: 'ok',
        snapshot: { ...snapshot, guardian_email: 'private@example.test' },
      }),
    ).toThrow(/ranking projection/i);
  });

  it('maps operational dashboard counts and rejects score-bearing payloads', async () => {
    const dashboard = {
      registrations: 10,
      checkedIn: 8,
      activeEvaluators: 3,
      completedEvaluations: 12,
      expectedEvaluations: 20,
      syncNeedsAttention: 1,
      generatedAt: '2026-08-29T12:00:00.000Z',
    };
    const result = await getLiveDashboard({ organizationId, tryoutId }, actor, {
      load: async () => ({ outcome: 'ok', dashboard }),
    });
    expect(result).toEqual({ ok: true, value: dashboard });
    expect(() =>
      parseLiveDashboardResponse({
        outcome: 'ok',
        dashboard: { ...dashboard, overall: '90.0' },
      }),
    ).toThrow(/dashboard projection/i);
  });
});
