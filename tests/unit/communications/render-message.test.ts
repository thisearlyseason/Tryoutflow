import { describe, expect, it } from 'vitest';

import { parseDecisionMessageKind } from '../../../src/modules/communications/application/render-message';

describe('decision message rendering boundary', () => {
  it.each(['callback', 'selected', 'waitlisted', 'released'] as const)(
    'accepts supported kind %s',
    (kind) => {
      expect(parseDecisionMessageKind(kind)).toBe(kind);
    },
  );
  it('rejects values outside the authoritative database renderer contract', () => {
    expect(() => parseDecisionMessageKind('private_note')).toThrow();
  });
});
