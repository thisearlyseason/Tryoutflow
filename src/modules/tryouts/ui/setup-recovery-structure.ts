import { z } from 'zod';
import {
  RegistrationBuiltInKeySchema,
  ReservedRegistrationFieldKeys,
} from '@/modules/registration/domain/form-schema';
const rubricCategory = z
  .object({
    name: z.string().max(160),
    weight: z.number().min(0).max(100),
    scaleMin: z.literal(1),
    scaleMax: z.union([z.literal(5), z.literal(10)]),
    description: z.string().max(2000).nullable().optional(),
    guidance: z.string().max(2000).nullable().optional(),
    isPriority: z.boolean().optional(),
  })
  .strict();
const builtIn = z
  .object({
    key: RegistrationBuiltInKeySchema,
    label: z.string().max(120),
    enabled: z.boolean(),
    required: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
const custom = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    label: z.string().max(120),
    kind: z.enum(['text', 'email', 'phone', 'date', 'select', 'checkbox', 'textarea', 'consent']),
    required: z.boolean(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative(),
    waiverText: z.string().max(20000).optional(),
    helpText: z.string().max(500).optional(),
    options: z.array(z.string().max(120)).max(100).optional(),
  })
  .strict()
  .refine(
    (f) =>
      !ReservedRegistrationFieldKeys.has(f.key) &&
      ![
        'custom_birth_date',
        'custom_guardian_name',
        'custom_guardian_email',
        'custom_guardian_phone',
      ].includes(f.key) &&
      (f.waiverText === undefined || f.kind === 'consent') &&
      (f.options === undefined || f.kind === 'select'),
  );
const questions = z
  .array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('builtIn'), field: builtIn }).strict(),
      z.object({ type: z.literal('custom'), field: custom }).strict(),
    ]),
  )
  .max(108)
  .refine((rows) => {
    const builtin = rows.filter((row) => row.type === 'builtIn');
    return (
      builtin.length <= 8 &&
      rows.length - builtin.length <= 100 &&
      new Set(rows.map((row) => row.field.key)).size === rows.length &&
      ['givenName', 'familyName', 'guardianEmail'].every((key) =>
        builtin.some((row) => row.field.key === key && row.field.enabled && row.field.required),
      )
    );
  });
export function validStructuredRecovery(form: string, fields: Record<string, string>): boolean {
  const kind = form.split(':')[0];
  if (kind !== 'rubrics' && kind !== 'registration') return true;
  try {
    return kind === 'rubrics'
      ? z.array(rubricCategory).min(1).max(100).safeParse(JSON.parse(fields.categories!)).success
      : questions.safeParse(JSON.parse(fields.questions!)).success;
  } catch {
    return false;
  }
}
