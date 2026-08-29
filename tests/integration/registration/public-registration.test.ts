import { describe, expect, it } from 'vitest';

import { validateRegistrationSubmission } from '../../../src/modules/registration/application/register-athlete';

describe('public registration validation', () => {
  it('rejects unknown response fields instead of accepting unpinned data', () => {
    expect(() =>
      validateRegistrationSubmission(
        {
          givenName: 'Ava',
          familyName: 'Smith',
          birthDate: '2013-05-01',
          guardian: { name: 'Taylor Smith', email: 'guardian@example.com' },
          responses: { consent: true, hidden: 'nope' },
        },
        {
          fields: [
            {
              key: 'consent',
              label: 'Consent',
              kind: 'consent',
              required: true,
              sortOrder: 0,
            },
          ],
        },
      ),
    ).toThrow(/unknown/i);
  });
});
