import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  loadOwnEvaluationDraft,
  type EvaluatorSessionData,
} from '@/modules/evaluations/infrastructure/evaluator-session-loader';

it('loads the rubric bound to an existing scorecard after setup changes', async () => {
  const predicates: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const result = {
      data:
        table === 'rubric_categories'
          ? [
              {
                id: 'old-category',
                name: 'Old skating',
                description: null,
                guidance: null,
                scale_min: 1,
                scale_max: 5,
              },
            ]
          : table === 'evaluation_notes'
            ? null
            : [],
      error: null,
    };
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => {
        predicates.push([table, ...args]);
        return query;
      },
      is: () => query,
      order: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  });
  const data = {
    current: { client: { from }, organization: { id: 'org' } },
    session: { tryoutId: 'tryout' },
    athletes: [{ registrationId: 'athlete' }],
    rubricVersionId: 'new-version',
    categories: [],
    evaluations: [
      {
        id: 'evaluation',
        registrationId: 'athlete',
        rubricVersionId: 'old-version',
        state: 'draft',
        version: 1,
      },
    ],
  } as unknown as EvaluatorSessionData;
  const result = await loadOwnEvaluationDraft(data, 'athlete');
  expect(result).toMatchObject({
    outcome: 'ready',
    rubricVersionId: 'old-version',
    categories: [{ id: 'old-category', name: 'Old skating', scaleMax: 5 }],
  });
  expect(predicates).toContainEqual(['rubric_categories', 'rubric_version_id', 'old-version']);
});

describe('new scorecard', () => {
  it('uses current criteria without reading historical data', async () => {
    const data = {
      athletes: [{ registrationId: 'athlete' }],
      evaluations: [],
      rubricVersionId: 'current',
      categories: [{ id: 'current-category' }],
    } as unknown as EvaluatorSessionData;
    expect(await loadOwnEvaluationDraft(data, 'athlete')).toMatchObject({
      outcome: 'ready',
      rubricVersionId: 'current',
      categories: [{ id: 'current-category' }],
    });
  });
});
