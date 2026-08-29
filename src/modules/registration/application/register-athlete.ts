import { z } from 'zod';

import { AthleteIdentitySchema } from '../../athletes/domain/athlete';
import type { RegistrationConfirmationNotifier } from './registration-confirmation-notifier';
import {
  RegistrationFormSchema,
  type RegistrationFormSchema as RegistrationForm,
} from '../domain/form-schema';
import {
  canonicalRegistrationText,
  isValidRegistrationCalendarDate,
  isValidRegistrationEmail,
  isValidRegistrationPhone,
  registrationCodePointLength,
} from '../domain/registration-validation';

const PhoneSchema = z
  .string()
  .transform(canonicalRegistrationText)
  .refine(isValidRegistrationPhone);

function contactName(maximum: number) {
  return z
    .string()
    .transform(canonicalRegistrationText)
    .refine(
      (value) =>
        registrationCodePointLength(value) >= 1 && registrationCodePointLength(value) <= maximum,
    );
}

const SubmissionSchema = AthleteIdentitySchema.extend({
  guardianName: contactName(160),
  guardianEmail: z.string().transform(canonicalRegistrationText).refine(isValidRegistrationEmail),
  guardianPhone: PhoneSchema.optional(),
  divisionId: z.uuid().optional(),
  positionId: z.uuid().optional(),
  responses: z.record(z.string(), z.unknown()),
}).strict();

export type RegistrationSubmission = z.infer<typeof SubmissionSchema>;

export function validateRegistrationSubmission(
  input: unknown,
  form: RegistrationForm,
): RegistrationSubmission {
  const submission = SubmissionSchema.parse(input);
  const schema = RegistrationFormSchema.parse(form);
  const fields = new Map(schema.fields.map((field) => [field.key, field]));

  for (const key of Object.keys(submission.responses)) {
    if (!fields.has(key)) throw new Error(`Unknown registration response field: ${key}`);
  }
  for (const field of fields.values()) {
    const value = submission.responses[field.key];
    if (
      field.required &&
      (value === undefined ||
        value === null ||
        (typeof value === 'string' && canonicalRegistrationText(value) === ''))
    ) {
      throw new Error(`Required registration response field: ${field.key}`);
    }
    if (value === undefined || value === null) continue;
    if (field.kind === 'consent' || field.kind === 'checkbox') {
      if (
        typeof value !== 'boolean' ||
        (field.kind === 'consent' && field.required && value !== true)
      ) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (field.kind === 'select') {
      if (typeof value !== 'string' || !field.options?.includes(value)) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (field.kind === 'date') {
      if (typeof value !== 'string' || !isValidRegistrationCalendarDate(value)) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (field.kind === 'email') {
      if (typeof value !== 'string' || !isValidRegistrationEmail(value)) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (field.kind === 'phone') {
      if (typeof value !== 'string' || !isValidRegistrationPhone(value)) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (
      typeof value !== 'string' ||
      registrationCodePointLength(canonicalRegistrationText(value)) >
        (field.kind === 'textarea' ? 5_000 : 500)
    ) {
      throw new Error(`Invalid registration response field: ${field.key}`);
    }
  }
  return submission;
}

export type RegisterAthleteGateway = {
  submit(input: {
    tryoutSlug: string;
    idempotencyKey: string;
    submission: RegistrationSubmission;
  }): Promise<
    | {
        outcome: 'submitted' | 'replayed';
        registrationId: string;
        confirmationToken: string;
      }
    | { outcome: 'registration_closed' | 'rate_limited' }
  >;
};

/** Application boundary shared by HTTP and future staff/import entry points. */
export async function registerAthlete(
  input: { tryoutSlug: string; idempotencyKey: string; submission: unknown },
  dependencies: {
    form: RegistrationForm;
    gateway: RegisterAthleteGateway;
    notifier: RegistrationConfirmationNotifier;
  },
): Promise<{
  accepted: boolean;
  delivery: 'queued' | 'not_configured' | 'not_attempted';
  confirmationToken?: string;
}> {
  const submission = validateRegistrationSubmission(input.submission, dependencies.form);
  const result = await dependencies.gateway.submit({
    tryoutSlug: input.tryoutSlug,
    idempotencyKey: input.idempotencyKey,
    submission,
  });
  if (result.outcome !== 'submitted' && result.outcome !== 'replayed')
    return { accepted: false, delivery: 'not_attempted' };
  const notification = await dependencies.notifier.enqueue({
    registrationId: result.registrationId,
    confirmationToken: result.confirmationToken,
    guardianEmail: submission.guardianEmail.trim().toLocaleLowerCase('en-CA'),
  });
  return {
    accepted: true,
    delivery: notification.queued ? 'queued' : 'not_configured',
    confirmationToken: notification.queued ? undefined : result.confirmationToken,
  };
}
