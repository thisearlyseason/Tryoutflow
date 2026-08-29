import { describe, expect, it } from 'vitest';

import { validateRegistrationSubmission } from '../../../src/modules/registration/application/register-athlete';
import { RegistrationFormSchema } from '../../../src/modules/registration/domain/form-schema';

describe('public registration validation', () => {
  it('rejects unknown response fields instead of accepting unpinned data', () => {
    expect(() =>
      validateRegistrationSubmission(
        {
          givenName: 'Ava',
          familyName: 'Smith',
          birthDate: '2013-05-01',
          guardianName: 'Taylor Smith',
          guardianEmail: 'guardian@example.com',
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

describe('registration form boundary', () => {
  it('rejects custom fields that collide with reserved PII and command keys', () => {
    expect(() =>
      RegistrationFormSchema.parse({
        fields: [
          { key: 'guardian_email', label: 'Spoof', kind: 'text', required: false, sortOrder: 0 },
        ],
      }),
    ).toThrow(/reserved/i);
  });
});
