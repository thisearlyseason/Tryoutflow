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

  const form = {
    fields: [
      {
        key: 'short_text',
        label: 'Short text',
        kind: 'text' as const,
        required: true,
        sortOrder: 0,
      },
      { key: 'email', label: 'Email', kind: 'email' as const, required: true, sortOrder: 1 },
      { key: 'phone', label: 'Phone', kind: 'phone' as const, required: true, sortOrder: 2 },
      { key: 'date', label: 'Date', kind: 'date' as const, required: true, sortOrder: 3 },
      {
        key: 'position',
        label: 'Position',
        kind: 'select' as const,
        required: true,
        sortOrder: 4,
        options: ['Goalie', 'Skater'],
      },
      {
        key: 'checked',
        label: 'Checked',
        kind: 'checkbox' as const,
        required: false,
        sortOrder: 5,
      },
      { key: 'notes', label: 'Notes', kind: 'textarea' as const, required: false, sortOrder: 6 },
    ],
  };

  const validSubmission = {
    givenName: 'Ava',
    familyName: 'Smith',
    birthDate: '2013-05-01',
    guardianName: 'Taylor Smith',
    guardianEmail: 'guardian@example.com',
    responses: {
      short_text: 'Forward',
      email: 'player@example.com',
      phone: '+1 (403) 555-0100',
      date: '2024-02-29',
      position: 'Goalie',
      checked: false,
      notes: '🥅'.repeat(5_000),
    },
  };

  it('accepts strict kind-specific values including a leap day and 5,000 Unicode code points', () => {
    expect(() => validateRegistrationSubmission(validSubmission, form)).not.toThrow();
  });

  it('uses canonical Unicode whitespace and Unicode code-point limits for identity and text', () => {
    const accepted = validateRegistrationSubmission(
      {
        ...validSubmission,
        givenName: `\u00a0${'🥅'.repeat(120)}\u3000`,
        guardianName: '\ufeffTaylor\u2003\u2003Smith\u00a0',
        guardianEmail: `\u3000${'a'.repeat(242)}@example.com\u00a0`,
        responses: {
          ...validSubmission.responses,
          short_text: `\u00a0${'🥅'.repeat(500)}\u3000`,
          email: `${'a'.repeat(242)}@example.com`,
        },
      },
      form,
    );
    expect(accepted.givenName).toBe('🥅'.repeat(120));
    expect(accepted.guardianName).toBe('Taylor Smith');
    expect(accepted.guardianEmail).toBe(`${'a'.repeat(242)}@example.com`);
  });

  it.each([
    ['identity max plus one code point', { givenName: '🥅'.repeat(121) }],
    ['guardian max plus one code point', { guardianName: '🥅'.repeat(161) }],
    ['whitespace-only identity', { givenName: '\u00a0\u2003\ufeff' }],
    ['year zero birth date', { birthDate: '0000-01-01' }],
    ['non-leap birth date', { birthDate: '2023-02-29' }],
    ['future birth date', { birthDate: '9999-12-31' }],
  ])('rejects %s with the shared identity rules', (_name, patch) => {
    expect(() => validateRegistrationSubmission({ ...validSubmission, ...patch }, form)).toThrow();
  });

  it.each([
    ['email syntax', { email: 'not-an-email' }],
    ['email length', { email: `${'a'.repeat(245)}@example.com` }],
    ['phone characters', { phone: '+1 403 CALL-NOW' }],
    ['phone digit length', { phone: '+1 (23) 45' }],
    ['non-calendar date', { date: '2023-02-29' }],
    ['year zero date', { date: '0000-01-01' }],
    ['non-padded date', { date: '2024-2-09' }],
    ['unknown select option', { position: 'Coach' }],
    ['non-boolean checkbox', { checked: 'false' }],
    ['oversize short text', { short_text: '🥅'.repeat(501) }],
    ['oversize textarea', { notes: '🥅'.repeat(5_001) }],
  ])('rejects invalid dynamic %s values', (_caseName, responsePatch) => {
    expect(() =>
      validateRegistrationSubmission(
        {
          ...validSubmission,
          responses: { ...validSubmission.responses, ...responsePatch },
        },
        form,
      ),
    ).toThrow(/invalid/i);
  });

  it('keeps guardian contact validation aligned with the SQL normalized phone limit', () => {
    expect(() =>
      validateRegistrationSubmission(
        { ...validSubmission, guardianPhone: '+1234567890123456' },
        form,
      ),
    ).toThrow();
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
