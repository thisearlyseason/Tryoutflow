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
  .regex(/^\+?[0-9 ()-]{7,32}$/)
  .refine(isValidPhone);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE_PATTERN = /^\+?[0-9 ()-]+$/u;

function codePointLength(value: string) {
  return Array.from(value).length;
}

function isValidEmail(value: string) {
  const normalized = value.trim();
  return codePointLength(normalized) <= 254 && EMAIL_PATTERN.test(normalized);
}

function isValidPhone(value: string) {
  const normalized = value.trim();
  const digits = normalized.replace(/\D/gu, '');
  return (
    codePointLength(normalized) <= 32 &&
    PHONE_PATTERN.test(normalized) &&
    digits.length >= 7 &&
    digits.length <= 15
  );
}

function isValidCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const SubmissionSchema = AthleteIdentitySchema.extend({
  guardianName: z.string().trim().min(1).max(160),
  guardianEmail: z.string().trim().refine(isValidEmail),
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
    if (
      field.required &&
      (value === undefined || value === null || (typeof value === 'string' && value.trim() === ''))
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
      if (typeof value !== 'string' || !isValidCalendarDate(value)) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (field.kind === 'email') {
      if (typeof value !== 'string' || !isValidEmail(value)) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (field.kind === 'phone') {
      if (typeof value !== 'string' || !isValidPhone(value)) {
        throw new Error(`Invalid registration response field: ${field.key}`);
      }
    } else if (
      typeof value !== 'string' ||
      codePointLength(value.trim()) > (field.kind === 'textarea' ? 5_000 : 500)
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
