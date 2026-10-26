import { describe, expect, it } from 'vitest';

import { validateTryoutBasics } from '../../../src/modules/tryouts/application/validate-tryout-basics';

const validInput = {
  name: ' U15 Fall Evaluations ',
  sport: ' Hockey ',
  timezone: ' America/Edmonton ',
  registrationStartsAt: '2026-09-15T18:00',
  registrationEndsAt: '2026-09-30T18:00',
};

describe('validateTryoutBasics', () => {
  it('returns bounded, trimmed local values for a valid registration window', () => {
    expect(validateTryoutBasics(validInput)).toEqual({
      ok: true,
      value: {
        name: 'U15 Fall Evaluations',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
        registrationStartsAt: '2026-09-15T18:00',
        registrationEndsAt: '2026-09-30T18:00',
      },
    });
  });

  it('assigns required errors to each empty field', () => {
    expect(
      validateTryoutBasics({
        name: '',
        sport: '   ',
        timezone: '',
        registrationStartsAt: '',
        registrationEndsAt: '',
      }),
    ).toEqual({
      ok: false,
      fieldErrors: {
        name: 'Enter a tryout name.',
        sport: 'Enter a sport.',
        timezone: 'Enter an IANA timezone.',
        registrationStartsAt: 'Enter when registration opens.',
        registrationEndsAt: 'Enter when registration closes.',
      },
    });
  });

  it('identifies invalid timezone and local date-time values independently', () => {
    expect(
      validateTryoutBasics({
        ...validInput,
        timezone: 'Mountain Time',
        registrationStartsAt: 'September 15 at six',
        registrationEndsAt: '2026-02-30T18:00',
      }),
    ).toEqual({
      ok: false,
      fieldErrors: {
        timezone: 'Enter a valid IANA timezone such as America/Edmonton.',
        registrationStartsAt: 'Enter a valid local date and time.',
        registrationEndsAt: 'Enter a valid local date and time.',
      },
    });
  });

  it('assigns an inverted registration window to the closing field', () => {
    expect(
      validateTryoutBasics({
        ...validInput,
        registrationStartsAt: '2026-09-30T18:00',
        registrationEndsAt: '2026-09-15T18:00',
      }),
    ).toEqual({
      ok: false,
      fieldErrors: { registrationEndsAt: 'Registration must close after it opens.' },
    });
  });

  it('rejects overlong text at the owning field', () => {
    const result = validateTryoutBasics({
      ...validInput,
      name: 'N'.repeat(161),
      sport: 'S'.repeat(81),
      timezone: 'T'.repeat(101),
    });

    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        name: 'Tryout name must be 160 characters or fewer.',
        sport: 'Sport must be 80 characters or fewer.',
        timezone: 'Timezone must be 100 characters or fewer.',
      },
    });
  });
});
