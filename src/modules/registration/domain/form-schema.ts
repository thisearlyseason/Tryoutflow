import { z } from 'zod';

const formFieldKinds = [
  'text',
  'email',
  'phone',
  'date',
  'select',
  'checkbox',
  'textarea',
  'consent',
] as const;

/** These values belong to the public command, never to editable form JSON. */
export const ReservedRegistrationFieldKeys = new Set([
  'given_name',
  'family_name',
  'birth_date',
  'guardian_name',
  'guardian_email',
  'guardian_phone',
  'guardian',
  'division_id',
  'responses',
  'idempotency_key',
]);

export const RegistrationFormFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,62}$/),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(formFieldKinds),
    required: z.boolean(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative(),
    waiverText: z.string().trim().min(1).max(20000).optional(),
    helpText: z.string().trim().max(500).optional(),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.kind !== 'consent' && field.waiverText !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'only consent fields use waiver wording',
        path: ['waiverText'],
      });
    }
    if (field.kind === 'select' && !field.options) {
      context.addIssue({
        code: 'custom',
        message: 'select fields require options',
        path: ['options'],
      });
    }
    if (field.kind !== 'select' && field.options) {
      context.addIssue({
        code: 'custom',
        message: 'only select fields use options',
        path: ['options'],
      });
    }
  });

export const RegistrationBuiltInKeySchema = z.enum([
  'givenName',
  'familyName',
  'birthDate',
  'guardianName',
  'guardianEmail',
  'guardianPhone',
  'divisionId',
  'positionId',
]);
export const RegistrationBuiltInFieldSchema = z
  .object({
    key: RegistrationBuiltInKeySchema,
    label: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    required: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
export type RegistrationBuiltInKey = z.infer<typeof RegistrationBuiltInKeySchema>;
export type RegistrationBuiltInField = z.infer<typeof RegistrationBuiltInFieldSchema>;

/** An allow-listed public registration schema; answers are validated against its immutable version. */
export const RegistrationFormSchema = z
  .object({
    fields: z.array(RegistrationFormFieldSchema).max(100),
    builtInFields: z.array(RegistrationBuiltInFieldSchema).max(8).optional(),
  })
  .strict()
  .superRefine((schema, context) => {
    if (schema.builtInFields) {
      if (
        schema.fields.some((field) =>
          [
            'custom_birth_date',
            'custom_guardian_name',
            'custom_guardian_email',
            'custom_guardian_phone',
          ].includes(field.key),
        )
      )
        context.addIssue({
          code: 'custom',
          message: 'Use built-in controls for identity and contact fields',
          path: ['fields'],
        });
      const builtinKeys = new Set<string>();
      const allOrder = new Set(schema.fields.map((field) => field.sortOrder));
      for (const [index, field] of schema.builtInFields.entries()) {
        if (builtinKeys.has(field.key) || allOrder.has(field.sortOrder))
          context.addIssue({
            code: 'custom',
            message: 'built-in keys and field ordering must be unique',
            path: ['builtInFields', index],
          });
        builtinKeys.add(field.key);
        allOrder.add(field.sortOrder);
      }
      for (const key of ['givenName', 'familyName', 'guardianEmail']) {
        if (
          !schema.builtInFields.some(
            (field) => field.key === key && field.enabled && field.required,
          )
        )
          context.addIssue({
            code: 'custom',
            message: 'Athlete name and contact email must remain enabled and required',
            path: ['builtInFields'],
          });
      }
    }
    const keys = new Set<string>();
    const order = new Set<number>();
    schema.fields.forEach((field, index) => {
      if (ReservedRegistrationFieldKeys.has(field.key)) {
        context.addIssue({
          code: 'custom',
          message: 'field keys cannot use reserved registration inputs',
          path: ['fields', index, 'key'],
        });
      }
      if (keys.has(field.key)) {
        context.addIssue({
          code: 'custom',
          message: 'field keys must be unique',
          path: ['fields', index, 'key'],
        });
      }
      if (order.has(field.sortOrder)) {
        context.addIssue({
          code: 'custom',
          message: 'field ordering must be unique',
          path: ['fields', index, 'sortOrder'],
        });
      }
      keys.add(field.key);
      order.add(field.sortOrder);
    });
  });

export type RegistrationFormSchema = z.infer<typeof RegistrationFormSchema>;
