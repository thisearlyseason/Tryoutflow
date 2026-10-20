import { z } from 'zod';

export const setupCategorySchema = z.object({
  name: z.string(),
  weight: z.number(),
  scaleMin: z.literal(1),
  scaleMax: z.union([z.literal(5), z.literal(10)]),
  description: z.string().nullable().optional(),
  guidance: z.string().nullable().optional(),
  isPriority: z.boolean().optional(),
});
export const setupConfigurationSchema = z.object({
  divisions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable().optional(),
      min_age: z.number().nullable().optional(),
      max_age: z.number().nullable().optional(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      division_id: z.string(),
      starts_at: z.string(),
      ends_at: z.string(),
      location: z.string().nullable(),
      capacity: z.number().nullable(),
      groups: z.array(z.object({ id: z.string(), name: z.string() })),
      rubric: z
        .object({
          id: z.string(),
          name: z.string(),
          versionId: z.string(),
          categories: z.array(setupCategorySchema),
        })
        .nullable(),
    }),
  ),
  positions: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type SetupConfiguration = z.infer<typeof setupConfigurationSchema>;
export type SetupCategory = z.infer<typeof setupCategorySchema>;
