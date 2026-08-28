import { describe, expect, it } from 'vitest';

import { transitionTryout, validateSession } from '../../../src/modules/tryouts/domain/lifecycle';

describe('tryout lifecycle', () => {
  it('publishes a draft only through the explicit publish transition', () => {
    expect(transitionTryout('draft', 'publish')).toBe('published');
  });

  it('finalizes a published tryout only through the explicit finalize transition', () => {
    expect(transitionTryout('published', 'finalize')).toBe('finalized');
  });

  it('rejects a finalized tryout regression', () => {
    expect(() => transitionTryout('finalized', 'publish')).toThrow('invalid transition');
    expect(() => transitionTryout('published', 'publish')).toThrow('invalid transition');
  });

  it('rejects a session whose ending instant is not after its starting instant', () => {
    const startAt = new Date('2026-09-10T17:00:00.000Z');

    expect(validateSession({ startAt, endAt: startAt })).toEqual({
      ok: false,
      code: 'invalid_time_range',
    });
  });
});
