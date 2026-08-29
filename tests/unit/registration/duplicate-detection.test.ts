import { describe, expect, it } from 'vitest';

import { noRegistrationConfirmationNotifier } from '../../../src/modules/registration/application/registration-confirmation-notifier';
import { registerAthlete } from '../../../src/modules/registration/application/register-athlete';
import { findDuplicateCandidates } from '../../../src/modules/registration/domain/duplicate-detection';

describe('duplicate detection', () => {
  it('flags a matching normalized name, birthdate, and guardian email for review only', () => {
    const result = findDuplicateCandidates(
      [
        {
          athleteId: 'a1',
          givenName: 'Ava',
          familyName: 'Smith',
          birthDate: '2013-05-01',
          guardianEmail: 'guardian@example.com',
        },
      ],
      {
        givenName: ' ava ',
        familyName: 'SMITH',
        birthDate: '2013-05-01',
        guardianEmail: 'GUARDIAN@example.com ',
      },
    );

    expect(result).toContainEqual(
      expect.objectContaining({ athleteId: 'a1', reason: 'name_birthdate_guardian_email' }),
    );
    expect(result).not.toContainEqual(expect.objectContaining({ action: 'auto_merge' }));
  });
});

describe('registration application command', () => {
  it('does not claim email delivery when the durable notifier is not configured', async () => {
    await expect(
      registerAthlete(
        {
          tryoutSlug: 'fall-id-camp',
          idempotencyKey: 'a'.repeat(32),
          submission: {
            givenName: 'Ava',
            familyName: 'Smith',
            birthDate: '2013-05-01',
            guardian: { name: 'Taylor Smith', email: 'guardian@example.com' },
            responses: { consent: true },
          },
        },
        {
          form: {
            fields: [
              { key: 'consent', label: 'Consent', kind: 'consent', required: true, sortOrder: 0 },
            ],
          },
          gateway: {
            submit: async () => ({
              outcome: 'submitted' as const,
              registrationId: 'r1',
              confirmationToken: 'secret',
            }),
          },
          notifier: noRegistrationConfirmationNotifier,
        },
      ),
    ).resolves.toEqual({ accepted: true, delivery: 'not_configured' });
  });
});
