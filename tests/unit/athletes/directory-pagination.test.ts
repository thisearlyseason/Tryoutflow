import { describe, expect, it } from 'vitest';

import { normalizeAthleteDirectoryPage } from '../../../src/modules/athletes/application/directory-pagination';

describe('athlete directory pagination', () => {
  it('clamps invalid and out-of-range pages to a real page', () => {
    expect(normalizeAthleteDirectoryPage(Number.NaN, 51, 50)).toBe(1);
    expect(normalizeAthleteDirectoryPage(-4, 51, 50)).toBe(1);
    expect(normalizeAthleteDirectoryPage(99, 51, 50)).toBe(2);
    expect(normalizeAthleteDirectoryPage(99, 0, 50)).toBe(1);
  });
});
