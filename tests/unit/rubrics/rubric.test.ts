import { describe, expect, it } from 'vitest';

import { RegistrationFormSchema } from '../../../src/modules/registration/domain/form-schema';
import {
  createRubricDraft,
  validateScale,
  validateWeightTotal,
} from '../../../src/modules/rubrics/domain/rubric';
import type { OrganizationId } from '../../../src/lib/ids';

describe('rubric validation', () => {
  it('accepts category weights that total exactly one hundred', () => {
    expect(validateWeightTotal([{ weight: 30 }, { weight: 70 }])).toEqual({ ok: true });
  });

  it('rejects category weights that do not total one hundred', () => {
    expect(validateWeightTotal([{ weight: 30 }, { weight: 60 }])).toEqual({
      ok: false,
      code: 'weights_must_total_100',
    });
  });

  it('does not accept unsupported scoring scales', () => {
    expect(validateScale({ min: 1, max: 7 })).toEqual({ ok: false, code: 'unsupported_scale' });
    expect(validateScale({ min: 1, max: 5 })).toEqual({ ok: true });
    expect(validateScale({ min: 1, max: 10 })).toEqual({ ok: true });
  });

  it('keeps deterministic category order in a draft', () => {
    const result = createRubricDraft({
      id: '11111111-1111-4111-8111-111111111111',
      organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId,
      tryoutId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Skating',
      categories: [
        { id: 'c2', name: 'Edges', sortOrder: 20, weight: '40.00', scale: { min: 1, max: 5 } },
        { id: 'c1', name: 'Speed', sortOrder: 10, weight: '60.00', scale: { min: 1, max: 10 } },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        categories: [expect.objectContaining({ id: 'c1' }), expect.objectContaining({ id: 'c2' })],
      }),
    });
  });

  it('validates an allow-listed public registration schema', () => {
    const valid = RegistrationFormSchema.safeParse({
      fields: [
        {
          key: 'guardian_contact_email',
          label: 'Guardian email',
          kind: 'email',
          required: true,
          sortOrder: 0,
        },
      ],
    });
    const invalid = RegistrationFormSchema.safeParse({
      fields: [{ key: 'freeform', label: 'Free form', kind: 'html', required: true, sortOrder: 0 }],
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('rejects unknown keys, wrong JSON types, and oversized form schemas', () => {
    expect(
      RegistrationFormSchema.safeParse({
        fields: [],
        analytics: true,
      }).success,
    ).toBe(false);
    expect(
      RegistrationFormSchema.safeParse({
        fields: [{ key: 'email', label: 'Email', kind: 'email', required: 'true', sortOrder: '0' }],
      }).success,
    ).toBe(false);
    expect(
      RegistrationFormSchema.safeParse({
        fields: Array.from({ length: 101 }, (_, sortOrder) => ({
          key: `field_${sortOrder}`,
          label: `Field ${sortOrder}`,
          kind: 'text',
          required: false,
          sortOrder,
        })),
      }).success,
    ).toBe(false);
  });
});
