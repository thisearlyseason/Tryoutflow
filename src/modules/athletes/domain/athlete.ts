import { z } from 'zod';

export const AthleteIdentitySchema = z
  .object({
    givenName: z.string().trim().min(1).max(120),
    familyName: z.string().trim().min(1).max(120),
    birthDate: z.iso.date(),
  })
  .strict();

export type AthleteIdentity = z.infer<typeof AthleteIdentitySchema>;
