import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FIELD_EXAMPLES } from '../../../src/components/forms/field-examples';

describe('field guidance', () => {
  it('defines the spacing token consumed by compact cards', () => {
    expect(readFileSync('src/app/theme.css', 'utf8')).toContain('--space-5: 1.25rem;');
  });

  it('provides exact fictional examples for the core journey', () => {
    expect(FIELD_EXAMPLES).toMatchObject({
      tryoutName: 'U15 Fall Evaluations',
      sport: 'Hockey',
      season: '2026 Fall Season',
      division: 'U15',
      session: 'Skills Session 1',
      rubric: 'Skating and Game Sense',
    });
  });
});
