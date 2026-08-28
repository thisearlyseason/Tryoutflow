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

export const RegistrationFormFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,62}$/),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(formFieldKinds),
    required: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    helpText: z.string().trim().max(500).optional(),
    options: z.array(z.string().trim().min(1).max(120)).min(1).max(100).optional(),
  })
  .superRefine((field, context) => {
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

/** An allow-listed public registration schema; answers are validated against its immutable version. */
export const RegistrationFormSchema = z
  .object({ fields: z.array(RegistrationFormFieldSchema).max(100) })
  .superRefine((schema, context) => {
    const keys = new Set<string>();
    const order = new Set<number>();
    schema.fields.forEach((field, index) => {
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
