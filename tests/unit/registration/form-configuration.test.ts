import { describe, expect, it } from 'vitest';
import { RegistrationFormSchema } from '../../../src/modules/registration/domain/form-schema';
import { DEFAULT_BUILT_IN_FIELDS } from '../../../src/modules/registration/domain/built-in-fields';
import {
  validateRegistrationSubmission,
  validateRegistrationResponses,
} from '../../../src/modules/registration/application/register-athlete';
const base = {
  givenName: 'Ava',
  familyName: 'Smith',
  birthDate: '2012-05-15',
  guardianName: 'Taylor',
  guardianEmail: 'guardian@example.test',
  responses: {},
};
function configured(disabled: string[] = []) {
  return {
    fields: [],
    builtInFields: DEFAULT_BUILT_IN_FIELDS.map((field) => ({
      ...field,
      enabled: !disabled.includes(field.key),
    })),
  };
}
describe('configurable registration fields', () => {
  it('accepts visibility metadata while preserving legacy forms', () => {
    expect(
      RegistrationFormSchema.safeParse(configured(['birthDate', 'guardianName'])).success,
    ).toBe(true);
    expect(RegistrationFormSchema.parse({ fields: [] })).toEqual({ fields: [] });
  });
  it('requires the minimum athlete and contact fields', () => {
    for (const key of ['givenName', 'familyName', 'guardianEmail'])
      expect(RegistrationFormSchema.safeParse(configured([key])).success).toBe(false);
  });
  it('accepts omitted disabled birth date and guardian name without invented values', () => {
    const form = configured(['birthDate', 'guardianName']);
    const result = validateRegistrationSubmission(
      { ...base, birthDate: undefined, guardianName: undefined },
      form,
    );
    expect(result.birthDate).toBeNull();
    expect(result.guardianName).toBeNull();
  });
  it('rejects submitted hidden identity details and still requires legacy birth dates', () => {
    expect(() => validateRegistrationSubmission(base, configured(['birthDate']))).toThrow();
    expect(() =>
      validateRegistrationSubmission({ ...base, birthDate: undefined }, { fields: [] }),
    ).toThrow();
  });
  it('ignores hidden required questions but rejects injected answers', () => {
    const form = {
      fields: [
        {
          key: 'waiver',
          kind: 'consent' as const,
          label: 'Waiver',
          required: true,
          enabled: false,
          sortOrder: 0,
        },
      ],
    };
    expect(validateRegistrationResponses({}, form)).toEqual({});
    expect(() => validateRegistrationResponses({ waiver: true }, form)).toThrow();
  });
  it('enforces optional field formats and configured required phone and position', () => {
    const form = configured();
    form.builtInFields = form.builtInFields.map((f) =>
      f.key === 'birthDate' ? { ...f, required: false } : f,
    );
    expect(
      validateRegistrationSubmission({ ...base, birthDate: undefined }, form).birthDate,
    ).toBeNull();
    expect(() =>
      validateRegistrationSubmission({ ...base, birthDate: 'nonsense' }, form),
    ).toThrow();
    form.builtInFields = form.builtInFields.map((f) =>
      ['guardianPhone', 'positionId'].includes(f.key) ? { ...f, required: true } : f,
    );
    expect(() => validateRegistrationSubmission(base, form)).toThrow();
  });
});

it('does not infer duplicate identity from missing birth dates', async () => {
  const { findDuplicateCandidates } =
    await import('../../../src/modules/registration/domain/duplicate-detection');
  expect(
    findDuplicateCandidates(
      [{ athleteId: 'one', givenName: 'Ava', familyName: 'Smith', birthDate: null }],
      { givenName: 'Ava', familyName: 'Smith', birthDate: null },
    ),
  ).toEqual([]);
});
