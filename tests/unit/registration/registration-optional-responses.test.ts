import { describe, expect, it } from 'vitest';
import { validateRegistrationResponses } from '../../../src/modules/registration/application/register-athlete';
import type { RegistrationFormSchema } from '../../../src/modules/registration/domain/form-schema';

describe('optional registration responses', () => {
  for (const kind of ['phone', 'email', 'date', 'select'] as const) {
    it(`omits blank optional ${kind} answers without weakening nonblank validation`, () => {
      const form: RegistrationFormSchema = {
        fields: [
          {
            key: 'extra',
            label: 'Extra',
            kind,
            required: false,
            sortOrder: 0,
            ...(kind === 'select' ? { options: ['One'] } : {}),
          },
        ],
      };
      expect(validateRegistrationResponses({ extra: '   ' }, form)).toEqual({});
      expect(() => validateRegistrationResponses({ extra: 'invalid' }, form)).toThrow();
      expect(() =>
        validateRegistrationResponses(
          { extra: '' },
          { fields: [{ ...form.fields[0]!, required: true }] },
        ),
      ).toThrow();
    });
  }
});

describe('enabled waiver acceptance', () => {
  const field = {
    key: 'waiver',
    label: 'Waiver',
    kind: 'consent' as const,
    required: false,
    sortOrder: 0,
  };
  it.each([{}, { waiver: false }, { waiver: null }])(
    'rejects missing or unchecked enabled consent despite an optional flag: %j',
    (responses) => {
      expect(() => validateRegistrationResponses(responses, { fields: [field] })).toThrow();
    },
  );
  it('accepts checked consent and allows a disabled waiver to be omitted', () => {
    expect(validateRegistrationResponses({ waiver: true }, { fields: [field] })).toEqual({
      waiver: true,
    });
    expect(validateRegistrationResponses({}, { fields: [{ ...field, enabled: false }] })).toEqual(
      {},
    );
  });
});
