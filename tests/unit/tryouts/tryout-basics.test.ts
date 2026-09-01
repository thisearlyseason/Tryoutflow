import { describe, expect, it } from 'vitest';

import {
  parseTryoutBasics,
  toDateTimeLocalValue,
} from '../../../src/modules/tryouts/ui/tryout-basics';

describe('tryout basics presentation', () => {
  it('formats stored instants in the tryout timezone for datetime-local controls', () => {
    expect(toDateTimeLocalValue('2026-09-10T15:00:00.000Z', 'America/Edmonton')).toBe(
      '2026-09-10T09:00',
    );
    expect(toDateTimeLocalValue('2026-12-10T15:00:00.000Z', 'America/Edmonton')).toBe(
      '2026-12-10T08:00',
    );
  });

  it('fails closed when the stored basics projection is malformed', () => {
    expect(
      parseTryoutBasics({
        name: 'Fall Tryout',
        sport: 'Hockey',
        timezone: 'Not/AZone',
        registration_starts_at: '2026-09-10T15:00:00.000Z',
        registration_ends_at: '2026-09-30T00:30:00.000Z',
      }),
    ).toBeNull();
  });

  it('accepts the offset timestamps returned by PostgREST', () => {
    expect(
      parseTryoutBasics({
        name: 'U15 Fall Evaluations',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
        registration_starts_at: '2026-09-26T20:57:00+00:00',
        registration_ends_at: '2026-09-27T20:57:00+00:00',
      }),
    ).toMatchObject({
      registrationStartsAt: '2026-09-26T14:57',
      registrationEndsAt: '2026-09-27T14:57',
    });
  });
});
