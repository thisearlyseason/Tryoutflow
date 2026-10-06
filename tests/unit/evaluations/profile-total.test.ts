import { describe, expect, it } from 'vitest';
import { profileTotal } from '@/modules/evaluations/domain/profile-total';
import { calculateAthleteAggregate } from '@/modules/scoring/domain/athlete-aggregate';

const criteria = [
  { id: 'control', scaleMax: 10 as const, weight: '20' },
  { id: 'finish', scaleMax: 5 as const, weight: '80' },
];

describe('profile and canonical rubric score alignment', () => {
  it('uses weighted mixed-scale scores, not a raw or unweighted average', () => {
    // (2/10 * 20) + (5/5 * 80) = 84; an unweighted average would be 60.
    expect(
      profileTotal(criteria, [
        { categoryId: 'control', value: 2 },
        { categoryId: 'finish', value: 5 },
      ]),
    ).toBe('84.0000');
  });
  it('matches the three evaluator ranking aggregate exactly', () => {
    const totals = [1, 3, 2].map((value) =>
      profileTotal(criteria, [
        { categoryId: 'control', value },
        { categoryId: 'finish', value: 5 },
      ])!,
    );
    expect(totals).toEqual(['82.0000', '86.0000', '84.0000']);
    expect(calculateAthleteAggregate(totals)).toBe('84.0000');
  });
  it('does not create a total for missing, duplicate, foreign, or invalid recovered scores', () => {
    const valid = [
      { categoryId: 'control', value: 2 },
      { categoryId: 'finish', value: 5 },
    ];
    for (const scores of [
      valid.slice(0, 1),
      [...valid, valid[0]!],
      [...valid, { categoryId: 'other-version', value: 5 }],
      [{ categoryId: 'control', value: 0 }, valid[1]!],
      [{ categoryId: 'control', value: 2.5 }, valid[1]!],
    ]) {
      expect(profileTotal(criteria, scores)).toBeNull();
    }
    expect(profileTotal([{ ...criteria[0]!, weight: '10' }, criteria[1]!], valid)).toBeNull();
  });
  it('preserves fractional weights and the canonical four-decimal boundary', () => {
    const categories = [
      { id: 'a', scaleMax: 5 as const, weight: '33.33' },
      { id: 'b', scaleMax: 10 as const, weight: '66.67' },
    ];
    expect(
      profileTotal(categories, [
        { categoryId: 'a', value: 4 },
        { categoryId: 'b', value: 7 },
      ]),
    ).toBe('73.3330');
  });
});
