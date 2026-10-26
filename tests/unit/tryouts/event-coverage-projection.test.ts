import { describe, expect, it } from 'vitest';
import { parseEventCoverage } from '../../../src/modules/tryouts/application/parse-event-coverage';

const id = '11111111-1111-4111-8111-111111111111';
const placement = {
  athlete_id: id,
  registration_id: id,
  name: 'Synthetic athlete',
  session_id: id,
  session: 'Skills',
  group: null,
  starts_at: '2026-10-18T10:00:00+00:00',
  ends_at: '2026-10-18T11:00:00+00:00',
  checked_in_at: null,
  evaluators: [
    {
      user_id: id,
      name: 'Synthetic evaluator',
      state: 'not_started',
      updated_at: null,
      evaluation_id: null,
      latest_sync_outcome: null,
    },
  ],
};
describe('coverage snapshot availability', () => {
  it('retains a valid empty authorized result', () => {
    expect(parseEventCoverage([])).toEqual([]);
  });
  it('does not convert unavailable/malformed results into an empty result', () => {
    for (const value of [null, undefined, {}, '[]', [{}], [{ ...placement, evaluators: null }]])
      expect(parseEventCoverage(value)).toBeNull();
  });
  it('retains unobserved and not-arrived independently from completed evaluation state', () => {
    expect(parseEventCoverage([placement])?.[0]).toMatchObject({
      checked_in_at: null,
      evaluators: [{ state: 'not_started' }],
    });
    expect(
      parseEventCoverage([
        {
          ...placement,
          evaluators: [{ ...placement.evaluators[0], state: 'completed', evaluation_id: id }],
        },
      ])?.[0]?.checked_in_at,
    ).toBeNull();
  });
  it('rejects invalid timestamps or unknown evaluator states rather than reporting completion', () => {
    expect(parseEventCoverage([{ ...placement, ends_at: 'not a timestamp' }])).toBeNull();
    expect(
      parseEventCoverage([
        { ...placement, evaluators: [{ ...placement.evaluators[0], state: 'unknown' }] },
      ]),
    ).toBeNull();
  });
});
