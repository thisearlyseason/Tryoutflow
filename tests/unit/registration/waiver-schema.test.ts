import { describe, expect, it } from 'vitest';
import { RegistrationFormSchema } from '../../../src/modules/registration/domain/form-schema';
const consent = {
  key: 'waiver',
  label: 'Participation',
  kind: 'consent',
  required: true,
  sortOrder: 0,
};
describe('waiver wording', () => {
  it('stores the complete wording on a consent field', () => {
    expect(
      RegistrationFormSchema.parse({
        fields: [{ ...consent, waiverText: '  Read these terms.\nSecond paragraph.  ' }],
      }).fields[0],
    ).toHaveProperty('waiverText', 'Read these terms.\nSecond paragraph.');
  });
  it.each(['', '   ', 'x'.repeat(20001), 42])(
    'rejects empty, oversized or non-text wording',
    (waiverText) => {
      expect(
        RegistrationFormSchema.safeParse({ fields: [{ ...consent, waiverText }] }).success,
      ).toBe(false);
    },
  );
  it('rejects wording on unrelated fields while preserving legacy consent', () => {
    expect(
      RegistrationFormSchema.safeParse({
        fields: [{ ...consent, kind: 'text', waiverText: 'Terms' }],
      }).success,
    ).toBe(false);
    expect(RegistrationFormSchema.safeParse({ fields: [consent] }).success).toBe(true);
  });
});
