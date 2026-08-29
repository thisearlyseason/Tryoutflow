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

  it('collapses the canonical Unicode whitespace set without auto-merging', () => {
    const result = findDuplicateCandidates(
      [
        {
          athleteId: 'a2',
          givenName: 'Ava\tMarie',
          familyName: 'Van\nDyke',
          birthDate: '2013-05-01',
          guardianEmail: 'guardian@example.com',
        },
      ],
      {
        givenName: '\u00a0AVA\u2003\u2003MARIE\u00a0',
        familyName: ' van  dyke ',
        birthDate: '2013-05-01',
        guardianEmail: '\u3000GUARDIAN@example.com\ufeff',
      },
    );

    expect(result).toEqual([{ athleteId: 'a2', reason: 'name_birthdate_guardian_email' }]);
    expect(result).not.toContainEqual(expect.objectContaining({ action: 'auto_merge' }));
  });

  it.each([
    ['composed existing and decomposed incoming', 'Jos\u00e9', 'Jose\u0301'],
    ['decomposed existing and composed incoming', 'Jose\u0301', 'Jos\u00e9'],
  ])('uses NFC identity parity for %s without auto-merging', (_caseName, existing, incoming) => {
    const result = findDuplicateCandidates(
      [
        {
          athleteId: 'nfc-candidate',
          givenName: existing,
          familyName: 'Nu\u00f1ez',
          birthDate: '2013-05-01',
          guardianEmail: 'guardian@example.com',
        },
      ],
      {
        givenName: incoming,
        familyName: 'Nun\u0303ez',
        birthDate: '2013-05-01',
        guardianEmail: 'GUARDIAN@example.com',
      },
    );

    expect(result).toEqual([
      { athleteId: 'nfc-candidate', reason: 'name_birthdate_guardian_email' },
    ]);
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
            guardianName: 'Taylor Smith',
            guardianEmail: 'guardian@example.com',
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
    ).resolves.toEqual({ accepted: true, delivery: 'not_configured', confirmationToken: 'secret' });
  });
});
