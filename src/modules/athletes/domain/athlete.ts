import { z } from 'zod';

import {
  canonicalRegistrationText,
  isValidBirthDate,
  registrationCodePointLength,
} from '../../registration/domain/registration-validation';

function identityText(maximum: number) {
  return z
    .string()
    .transform(canonicalRegistrationText)
    .refine(
      (value) =>
        registrationCodePointLength(value) >= 1 && registrationCodePointLength(value) <= maximum,
    );
}

export const AthleteIdentitySchema = z
  .object({
    givenName: identityText(120),
    familyName: identityText(120),
    birthDate: z.string().refine(isValidBirthDate),
  })
  .strict();

export type AthleteIdentity = z.infer<typeof AthleteIdentitySchema>;
