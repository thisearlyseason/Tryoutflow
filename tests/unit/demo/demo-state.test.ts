import { describe, expect, it } from 'vitest';
import {
  createDemo,
  DEMO_DURATION_MS,
  readDemo,
  updateDemo,
  demoRankings,
} from '@/modules/demo/demo-state';

describe('pre-created demo lifecycle', () => {
  const now = 1_800_000_000_000;
  it('restores changes without restarting the 30-minute clock', () => {
    const original = createDemo(now);
    const edited = updateDemo(original, { type: 'check-in', id: 7 }, now + 1000);
    const restored = readDemo(JSON.stringify(edited), now + 5000);
    expect(restored.athletes[6]?.checkedIn).toBe(true);
    expect(restored.expiresAt).toBe(now + DEMO_DURATION_MS);
    expect(original.athletes[6]?.checkedIn).toBe(false);
  });
  it('resets exactly at expiry and rejects an expired-screen edit', () => {
    const state = updateDemo(createDemo(now), { type: 'add-athlete' }, now);
    expect(readDemo(JSON.stringify(state), now + DEMO_DURATION_MS - 1).athletes).toHaveLength(9);
    const reset = readDemo(JSON.stringify(state), now + DEMO_DURATION_MS);
    expect(reset.athletes).toHaveLength(8);
    expect(reset.expiresAt).toBe(now + DEMO_DURATION_MS * 2);
    expect(
      updateDemo(state, { type: 'rename', value: 'Old screen' }, now + DEMO_DURATION_MS),
    ).toEqual(reset);
  });
  it.each([
    'invalid JSON',
    '{}',
    JSON.stringify({ ...createDemo(now), expiresAt: now + 999999999 }),
  ])('recovers from invalid saved data', (raw) => {
    expect(readDemo(raw, now)).toEqual(createDemo(now));
  });
  it('recovers after suspension or a backwards clock change', () => {
    const state = updateDemo(createDemo(now), { type: 'rename', value: 'Edited' }, now);
    expect(readDemo(JSON.stringify(state), now + DEMO_DURATION_MS * 10).eventName).toBe(
      createDemo(now).eventName,
    );
    expect(readDemo(JSON.stringify(state), now - 100).startedAt).toBe(now - 100);
  });
  it('ranks only complete scorecards and preserves ties', () => {
    let state = createDemo(now);
    expect(demoRankings(state.athletes).map((entry) => entry.athlete.id)).not.toContain(7);
    for (let criterion = 0; criterion < 3; criterion++)
      state = updateDemo(state, { type: 'score', id: 7, criterion, value: 5 }, now);
    expect(demoRankings(state.athletes)[0]).toMatchObject({
      rank: 1,
      average: '5.00',
      athlete: { id: 7 },
    });
    const tied = demoRankings(state.athletes).filter((entry) => [1, 3].includes(entry.athlete.id));
    expect(tied.map((entry) => entry.rank)).toEqual([3, 3]);
    expect(tied.every((entry) => entry.tied)).toBe(true);
  });
  it('bounds sample registrations and scores', () => {
    let state = createDemo(now);
    for (let i = 0; i < 30; i++) state = updateDemo(state, { type: 'add-athlete' }, now);
    expect(state.athletes).toHaveLength(24);
    const invalid = updateDemo(state, { type: 'score', id: 7, criterion: 9, value: 10 }, now);
    expect(invalid.athletes[6]?.scores).toEqual([null, null, null]);
  });
});
