import { describe, expect, it } from 'vitest';

import {
  calculateAthleteAggregate,
  summarizeAthleteScores,
} from '../../../src/modules/scoring/domain/athlete-aggregate';
import { calculateEvaluatorTotal } from '../../../src/modules/scoring/domain/evaluator-total';
import { normalizeScore } from '../../../src/modules/scoring/domain/normalize-score';
import { rankAthletes } from '../../../src/modules/scoring/domain/rank-athletes';

const threeCategoryScores = [
  { categoryId: 'skating', score: 4, scaleMax: 5, weight: '40.0000', required: true },
  { categoryId: 'skills', score: 9, scaleMax: 10, weight: '30.0000', required: true },
  { categoryId: 'awareness', score: 8, scaleMax: 10, weight: '30.0000', required: true },
] as const;

function completedEvaluation(overrides: Record<string, unknown> = {}) {
  return {
    evaluationId: 'evaluation-1',
    evaluatorId: 'evaluator-1',
    divisionId: 'division-u15',
    sessionId: 'session-1',
    state: 'completed' as const,
    assignmentState: 'active' as const,
    categories: threeCategoryScores,
    ...overrides,
  };
}

describe('score normalization', () => {
  it.each([
    [{ score: 4, scaleMax: 5 }, '80.0000'],
    [{ score: 8, scaleMax: 10 }, '80.0000'],
    [{ score: 1, scaleMax: 5 }, '20.0000'],
    [{ score: 2, scaleMax: 3 }, '66.6667'],
    [{ score: 999_999, scaleMax: 1_000_000 }, '99.9999'],
  ])(
    'normalizes inclusive positive integer scales without binary-float drift',
    (input, expected) => {
      expect(normalizeScore(input)).toBe(expected);
    },
  );

  it.each([
    { score: 0, scaleMax: 5 },
    { score: 6, scaleMax: 5 },
    { score: 1.5, scaleMax: 5 },
    { score: Number.NaN, scaleMax: 5 },
    { score: Number.POSITIVE_INFINITY, scaleMax: 5 },
    { score: 1, scaleMax: 0 },
    { score: 1, scaleMax: -5 },
    { score: 1, scaleMax: 1.5 },
    { score: 1, scaleMax: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid score and scale bounds %#', (input) => {
    expect(() => normalizeScore(input)).toThrow(RangeError);
  });
});

describe('evaluator totals', () => {
  it('uses exact weights and raw scale ratios until the final four-decimal rounding boundary', () => {
    expect(calculateEvaluatorTotal(threeCategoryScores)).toBe('83.0000');
    expect(
      calculateEvaluatorTotal([
        { categoryId: 'one', score: 2, scaleMax: 3, weight: '50', required: true },
        { categoryId: 'two', score: 1, scaleMax: 3, weight: '50', required: true },
      ]),
    ).toBe('50.0000');
  });

  it('returns no total when required work is missing instead of treating it as zero', () => {
    expect(
      calculateEvaluatorTotal([
        { categoryId: 'one', score: 4, scaleMax: 5, weight: '50', required: true },
        { categoryId: 'two', score: null, scaleMax: 5, weight: '50', required: true },
      ]),
    ).toBeNull();
  });

  it('validates the complete immutable rubric before returning a missing-work result', () => {
    expect(() =>
      calculateEvaluatorTotal([
        { categoryId: 'one', score: null, scaleMax: 5, weight: '50', required: true },
        { categoryId: 'one', score: 4, scaleMax: 5, weight: '50', required: true },
      ]),
    ).toThrow(/duplicate/i);
  });

  it('binds separate score rows to known immutable rubric categories', () => {
    const calculateSnapshotTotal = calculateEvaluatorTotal;
    const categories = [
      { categoryId: 'skating', scaleMax: 5, weight: '50', required: true },
      { categoryId: 'skills', scaleMax: 10, weight: '50', required: true },
    ];
    expect(
      calculateSnapshotTotal({
        categories,
        scores: [
          { categoryId: 'skating', score: 4 },
          { categoryId: 'skills', score: 8 },
        ],
      }),
    ).toBe('80.0000');
    expect(() =>
      calculateSnapshotTotal({ categories, scores: [{ categoryId: 'unknown', score: 4 }] }),
    ).toThrow(/unknown/i);
    expect(() =>
      calculateSnapshotTotal({
        categories,
        scores: [
          { categoryId: 'skating', score: 4 },
          { categoryId: 'skating', score: 5 },
        ],
      }),
    ).toThrow(/duplicate/i);
  });

  it('renormalizes explicitly optional missing categories over the completed weight only', () => {
    expect(
      calculateEvaluatorTotal([
        { categoryId: 'required', score: 4, scaleMax: 5, weight: '75', required: true },
        { categoryId: 'optional', score: null, scaleMax: 5, weight: '25', required: false },
      ]),
    ).toBe('80.0000');
  });

  it.each([
    { categories: [] },
    {
      categories: [
        { categoryId: 'one', score: 4, scaleMax: 5, weight: '60', required: true },
        { categoryId: 'two', score: 4, scaleMax: 5, weight: '30', required: true },
      ],
    },
    {
      categories: [
        { categoryId: 'one', score: 4, scaleMax: 5, weight: '50', required: true },
        { categoryId: 'one', score: 4, scaleMax: 5, weight: '50', required: true },
      ],
    },
    { categories: [{ categoryId: 'one', score: 4, scaleMax: 5, weight: 'NaN', required: true }] },
    { categories: [{ categoryId: 'one', score: 4, scaleMax: 5, weight: '1e2', required: true }] },
    {
      categories: [
        { categoryId: 'one', score: 4, scaleMax: 5, weight: '100.000000001', required: true },
      ],
    },
    { categories: [{ categoryId: 'one', score: 4, scaleMax: 5, weight: '-0', required: true }] },
    {
      categories: [
        { categoryId: 'one', score: 4, scaleMax: 5, weight: 'Infinity', required: true },
      ],
    },
  ])(
    'rejects malformed, ambiguous, duplicate, or non-100 weighted rubrics %#',
    ({ categories }) => {
      expect(() => calculateEvaluatorTotal(categories)).toThrow();
    },
  );

  it('rejects a category collection beyond the bounded domain limit', () => {
    const categories = Array.from({ length: 101 }, (_, index) => ({
      categoryId: `category-${index}`,
      score: 5,
      scaleMax: 5,
      weight: index === 0 ? '100' : '0',
      required: true,
    }));
    expect(() => calculateEvaluatorTotal(categories)).toThrow(RangeError);
  });
});

describe('athlete aggregation and scope', () => {
  it('averages canonical completed evaluator totals and returns null for zero completion', () => {
    expect(calculateAthleteAggregate(['82.0000', '86.0000', '84.0000'])).toBe('84.0000');
    expect(calculateAthleteAggregate(['83.3333', '83.3334'])).toBe('83.3334');
    expect(calculateAthleteAggregate([])).toBeNull();
  });

  it('includes only active completed or locked immutable snapshots', () => {
    const summary = summarizeAthleteScores([
      completedEvaluation(),
      completedEvaluation({
        evaluationId: 'evaluation-2',
        evaluatorId: 'evaluator-2',
        state: 'locked',
      }),
      completedEvaluation({
        evaluationId: 'evaluation-3',
        evaluatorId: 'evaluator-3',
        state: 'draft',
      }),
      completedEvaluation({
        evaluationId: 'evaluation-4',
        evaluatorId: 'evaluator-4',
        state: 'reopened',
      }),
      completedEvaluation({
        evaluationId: 'evaluation-5',
        evaluatorId: 'evaluator-5',
        assignmentState: 'removed',
      }),
      completedEvaluation({
        evaluationId: 'evaluation-6',
        evaluatorId: 'evaluator-6',
        assignmentState: 'invalidated',
      }),
      completedEvaluation({
        evaluationId: 'evaluation-7',
        evaluatorId: 'evaluator-7',
        assignmentState: 'revoked',
      }),
    ]);

    expect(summary).toEqual({
      aggregate: '83.0000',
      completedEvaluatorCount: 2,
      scoreRange: ['83.0000', '83.0000'],
      priorityCategoryAggregate: null,
    });
  });

  it('applies exact session and division filters before aggregation', () => {
    const evaluations = [
      completedEvaluation(),
      completedEvaluation({
        evaluationId: 'evaluation-2',
        evaluatorId: 'evaluator-2',
        sessionId: 'session-2',
        categories: [{ categoryId: 'all', score: 5, scaleMax: 5, weight: '100', required: true }],
      }),
      completedEvaluation({
        evaluationId: 'evaluation-3',
        evaluatorId: 'evaluator-3',
        divisionId: 'division-u18',
        categories: [{ categoryId: 'all', score: 1, scaleMax: 5, weight: '100', required: true }],
      }),
    ];

    expect(
      summarizeAthleteScores(evaluations, { sessionId: 'session-2', divisionId: 'division-u15' }),
    ).toMatchObject({ aggregate: '100.0000', completedEvaluatorCount: 1 });
    expect(summarizeAthleteScores(evaluations, { sessionId: 'SESSION-2' }).aggregate).toBeNull();
  });

  it('aggregates one explicitly configured priority category across included evaluations', () => {
    const categories = [
      {
        categoryId: 'skating',
        score: 4,
        scaleMax: 5,
        weight: '50',
        required: true,
        isPriority: true,
      },
      { categoryId: 'skills', score: 5, scaleMax: 5, weight: '50', required: true },
    ];
    const summary = summarizeAthleteScores([
      completedEvaluation({ categories }),
      completedEvaluation({
        evaluationId: 'evaluation-2',
        evaluatorId: 'evaluator-2',
        categories: categories.map((category) =>
          category.categoryId === 'skating' ? { ...category, score: 3 } : category,
        ),
      }),
    ]);
    expect(summary).toMatchObject({ aggregate: '85.0000', priorityCategoryAggregate: '70.0000' });
  });

  it.each([
    { totals: ['NaN'] },
    { totals: ['Infinity'] },
    { totals: ['-0.0000'] },
    { totals: ['84'] },
    { totals: ['84.0'] },
    { totals: ['84.00000'] },
    { totals: [' 84.0000'] },
    { totals: ['100.0001'] },
  ])('rejects malformed canonical aggregate input %#', ({ totals }) => {
    expect(() => calculateAthleteAggregate(totals)).toThrow();
  });

  it('rejects duplicate evaluation identities and inconsistent priority configuration', () => {
    expect(() => summarizeAthleteScores([completedEvaluation(), completedEvaluation()])).toThrow();
    expect(() =>
      summarizeAthleteScores([
        completedEvaluation({
          categories: [
            {
              categoryId: 'one',
              score: 4,
              scaleMax: 5,
              weight: '50',
              required: true,
              isPriority: true,
            },
            {
              categoryId: 'two',
              score: 4,
              scaleMax: 5,
              weight: '50',
              required: true,
              isPriority: true,
            },
          ],
        }),
      ]),
    ).toThrow();
  });

  it('rejects missing priority configuration independent of snapshot order', () => {
    const withPriority = completedEvaluation({
      evaluationId: 'evaluation-priority',
      evaluatorId: 'evaluator-priority',
      categories: [
        {
          categoryId: 'skating',
          score: 4,
          scaleMax: 5,
          weight: '100',
          required: true,
          isPriority: true,
        },
      ],
    });
    const withoutPriority = completedEvaluation({
      evaluationId: 'evaluation-no-priority',
      evaluatorId: 'evaluator-no-priority',
      categories: [{ categoryId: 'skating', score: 4, scaleMax: 5, weight: '100', required: true }],
    });
    expect(() => summarizeAthleteScores([withoutPriority, withPriority])).toThrow(/priority/i);
    expect(() => summarizeAthleteScores([withPriority, withoutPriority])).toThrow(/priority/i);
  });

  it('bounds evaluator cardinality', () => {
    const evaluations = Array.from({ length: 1001 }, (_, index) =>
      completedEvaluation({
        evaluationId: `evaluation-${index}`,
        evaluatorId: `evaluator-${index}`,
      }),
    );
    expect(() => summarizeAthleteScores(evaluations)).toThrow(RangeError);
  });
});

describe('deterministic ranking', () => {
  it('uses competition ranking, priority-category precedence, and explicit stable tie order', () => {
    const ranked = rankAthletes([
      {
        athleteId: 'athlete-c',
        stableOrder: '003',
        summary: { aggregate: '80.0000', priorityCategoryAggregate: '90.0000' },
      },
      {
        athleteId: 'athlete-b',
        stableOrder: '002',
        summary: { aggregate: '90.0000', priorityCategoryAggregate: '70.0000' },
      },
      {
        athleteId: 'athlete-a',
        stableOrder: '001',
        summary: { aggregate: '90.0000', priorityCategoryAggregate: '80.0000' },
      },
      {
        athleteId: 'athlete-d',
        stableOrder: '004',
        summary: { aggregate: null, priorityCategoryAggregate: null },
      },
    ]);
    expect(ranked.map(({ athleteId, rank }) => [athleteId, rank])).toEqual([
      ['athlete-a', 1],
      ['athlete-b', 2],
      ['athlete-c', 3],
      ['athlete-d', null],
    ]);
    expect(ranked.every((row) => !('selected' in row) && !('decision' in row))).toBe(true);
  });

  it('keeps equal canonical score and priority values tied with stable technical ordering only', () => {
    const ranked = rankAthletes([
      {
        athleteId: 'athlete-b',
        stableOrder: '002',
        summary: { aggregate: '84.0000', priorityCategoryAggregate: '80.0000' },
      },
      {
        athleteId: 'athlete-a',
        stableOrder: '001',
        summary: { aggregate: '84.0000', priorityCategoryAggregate: '80.0000' },
      },
      {
        athleteId: 'athlete-c',
        stableOrder: '003',
        summary: { aggregate: '70.0000', priorityCategoryAggregate: '90.0000' },
      },
    ]);
    expect(ranked.map(({ athleteId, rank, isTied }) => [athleteId, rank, isTied])).toEqual([
      ['athlete-a', 1, true],
      ['athlete-b', 1, true],
      ['athlete-c', 3, false],
    ]);
  });

  it('fails closed when scored rows disagree on whether a priority category is configured', () => {
    expect(() =>
      rankAthletes([
        {
          athleteId: 'athlete-a',
          stableOrder: '001',
          summary: { aggregate: '84.0000', priorityCategoryAggregate: '80.0000' },
        },
        {
          athleteId: 'athlete-b',
          stableOrder: '002',
          summary: { aggregate: '84.0000', priorityCategoryAggregate: null },
        },
      ]),
    ).toThrow(/priority/i);
  });

  it('projects evidence fields only and cannot carry roster decisions through scoring', () => {
    const untrusted = {
      athleteId: 'athlete-a',
      stableOrder: '001',
      selected: true,
      decision: 'selected',
      summary: {
        aggregate: '84.0000',
        priorityCategoryAggregate: null,
        selected: true,
      },
    };
    const [ranked] = rankAthletes([untrusted]);
    expect(ranked).toEqual({
      athleteId: 'athlete-a',
      stableOrder: '001',
      summary: { aggregate: '84.0000', priorityCategoryAggregate: null },
      rank: 1,
      isTied: false,
    });
  });

  it('is invariant to input ordering and deterministic over repeated seeded permutations', () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({
      athleteId: `athlete-${index}`,
      stableOrder: String(index).padStart(3, '0'),
      summary: {
        aggregate: `${String(100 - (index % 11)).padStart(2, '0')}.0000`,
        priorityCategoryAggregate: null,
      },
    }));
    const expected = rankAthletes(rows);
    for (let shift = 1; shift < rows.length; shift += 1) {
      const permutation = [...rows.slice(shift), ...rows.slice(0, shift)].reverse();
      expect(rankAthletes(permutation)).toEqual(expected);
    }
  });

  it('preserves bounds and monotonicity over a deterministic score matrix', () => {
    expect(
      Array.from({ length: 10 }, (_, index) => normalizeScore({ score: index + 1, scaleMax: 10 })),
    ).toEqual([
      '10.0000',
      '20.0000',
      '30.0000',
      '40.0000',
      '50.0000',
      '60.0000',
      '70.0000',
      '80.0000',
      '90.0000',
      '100.0000',
    ]);
  });

  it.each([
    {
      rows: [
        {
          athleteId: 'same',
          stableOrder: '001',
          summary: { aggregate: '80.0000', priorityCategoryAggregate: null },
        },
        {
          athleteId: 'same',
          stableOrder: '002',
          summary: { aggregate: '70.0000', priorityCategoryAggregate: null },
        },
      ],
    },
    {
      rows: [
        {
          athleteId: 'one',
          stableOrder: 'same',
          summary: { aggregate: '80.0000', priorityCategoryAggregate: null },
        },
        {
          athleteId: 'two',
          stableOrder: 'same',
          summary: { aggregate: '70.0000', priorityCategoryAggregate: null },
        },
      ],
    },
  ])('rejects duplicate athlete or stable-order identities %#', ({ rows }) => {
    expect(() => rankAthletes(rows)).toThrow();
  });
});
