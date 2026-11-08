import { describe, expect, it, vi } from 'vitest';
import { recommendHomeWork, buildHomeTasks } from '@/modules/organizations/application/home-work';
import type { TryoutJourney } from '@/modules/tryouts/application/load-tryout-journey';

describe('scoped home recommendations', () => {
  it('uses the selected active event instead of any old completed program history', async () => {
    const journey = { tryout: { id: 'new-draft' }, nextStage: 'prepare' } as TryoutJourney;
    const load = vi.fn().mockResolvedValue(journey);
    expect(await recommendHomeWork({ id: 'new-draft' }, 4, load)).toEqual({
      kind: 'journey',
      journey,
    });
    expect(load).toHaveBeenCalledWith('new-draft');
  });
  it('distinguishes first use from previous finished work and failed reads', async () => {
    const load = vi.fn();
    expect(await recommendHomeWork(null, 0, load)).toEqual({ kind: 'first-tryout' });
    expect(await recommendHomeWork(null, 4, load)).toEqual({ kind: 'history' });
    expect(await recommendHomeWork(undefined, 0, load)).toEqual({ kind: 'unavailable' });
    expect(await recommendHomeWork(null, null, load)).toEqual({ kind: 'unavailable' });
    expect(load).not.toHaveBeenCalled();
  });
  it('keeps read failures recoverable without suggesting a duplicate first event', async () => {
    expect(
      await recommendHomeWork({ id: 'event' }, 0, vi.fn().mockRejectedValue(Error('offline'))),
    ).toEqual({ kind: 'unavailable' });
  });
  it('prioritizes actual assigned evaluation work and only returns supplied destinations', () => {
    const tasks = buildHomeTasks(
      [
        {
          id: 'workspace',
          label: 'My workspace',
          items: [
            { label: 'Scouting', href: '/app/club/scouting', icon: 'evaluate' },
            { label: 'Live', href: '/app/club/tryouts/event/live', icon: 'home' },
            { label: 'Evaluate', href: '/app/club/evaluate', icon: 'evaluate' },
          ],
        },
      ],
      new Map([['event', 'U15 event']]),
    );
    expect(tasks[0]).toMatchObject({ label: 'Evaluate athletes', href: '/app/club/evaluate' });
    expect(tasks.find((t) => t.href.endsWith('/live'))?.description).toBe('U15 event');
    expect(tasks).toHaveLength(3);
    expect(buildHomeTasks([])).toEqual([]);
  });
});
