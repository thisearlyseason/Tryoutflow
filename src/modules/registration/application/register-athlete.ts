import { z } from 'zod';

import { AthleteIdentitySchema } from '../../athletes/domain/athlete';
import type { RegistrationConfirmationNotifier } from './registration-confirmation-notifier';
import {
  RegistrationFormSchema,
  type RegistrationFormSchema as RegistrationForm,
} from '../domain/form-schema';

const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,32}$/);

const SubmissionSchema = AthleteIdentitySchema.extend({
  guardianName: z.string().trim().min(1).max(160),
  guardianEmail: z.email().trim().max(254),
  guardianPhone: PhoneSchema.optional(),
  divisionId: z.uuid().optional(),
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
    if (field.required && (value === undefined || value === null || value === '')) {
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
      if (typeof value !== 'string' || !z.iso.date().safeParse(value).success) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (typeof value !== 'string' || value.trim().length > 5000) {
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
    | { outcome: 'submitted'; registrationId: string; confirmationToken: string }
    | { outcome: 'replayed' | 'registration_closed' | 'rate_limited' }
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
  if (result.outcome !== 'submitted')
    return { accepted: result.outcome === 'replayed', delivery: 'not_attempted' };
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
