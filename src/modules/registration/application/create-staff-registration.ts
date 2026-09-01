import { createHash } from 'node:crypto';

import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { Json } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { RegistrationFormSchema as RegistrationForm } from '../domain/form-schema';
import { validateRegistrationResponses } from './register-athlete';

const schema = z
  .object({
    organizationId: z.uuid(),
    tryoutId: z.uuid(),
    existingAthleteId: z.uuid().optional(),
    divisionId: z.uuid(),
    positionId: z.uuid().optional(),
    givenName: z.string().trim().min(1).max(120).optional(),
    familyName: z.string().trim().min(1).max(120).optional(),
    birthDate: z.iso.date().optional(),
    responses: z.record(z.string().min(1).max(80), z.unknown()),
    idempotencyKey: z.uuid(),
  })
  .refine(
    (value) =>
      Boolean(value.existingAthleteId) !==
      Boolean(value.givenName && value.familyName && value.birthDate),
    { message: 'Select one returning athlete or enter one new athlete' },
  );

export type StaffRegistrationGateway = {
  create(input: {
    organizationId: string;
    tryoutId: string;
    existingAthleteId?: string;
    divisionId: string;
    positionId?: string;
    givenName?: string;
    familyName?: string;
    birthDate?: string;
    responses: Record<string, unknown>;
    submissionKeyDigest: string;
  }): Promise<{ outcome: string; registrationId?: string; athleteId?: string }>;
};

export type StaffRegistrationDependencies = {
  form: RegistrationForm;
  gateway?: StaffRegistrationGateway;
};

async function defaultGateway(): Promise<StaffRegistrationGateway> {
  const client = await createServerSupabaseClient();
  return {
    async create(input) {
      const result = await client.rpc('create_staff_registration', {
        p_organization_id: input.organizationId,
        p_tryout_id: input.tryoutId,
        p_existing_athlete_id: (input.existingAthleteId ?? null) as unknown as string,
        p_division_id: input.divisionId,
        p_position_id: (input.positionId ?? null) as unknown as string,
        p_given_name: (input.givenName ?? null) as unknown as string,
        p_family_name: (input.familyName ?? null) as unknown as string,
        p_birth_date: (input.birthDate ?? null) as unknown as string,
        p_responses: input.responses as Json,
        p_submission_key_digest: input.submissionKeyDigest,
      });
      const row = result.data?.[0];
      if (result.error || !row) throw result.error ?? new Error('Registration command failed');
      return {
        outcome: row.outcome,
        registrationId: row.registration_id ?? undefined,
        athleteId: row.athlete_id ?? undefined,
      };
    },
  };
}

export async function createStaffRegistration(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: StaffRegistrationDependencies,
): Promise<
  AppResult<
    { registrationId: string; athleteId: string; replayed: boolean },
    {
      code: 'invalid_input' | 'idempotency_conflict' | 'forbidden' | 'not_found' | 'unavailable';
    }
  >
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    !requireCapability(actor.authorization, 'tryout:write', {
      organizationId,
      tryoutId: parsed.data.tryoutId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  let responses: Record<string, unknown>;
  try {
    responses = validateRegistrationResponses(parsed.data.responses, dependencies.form);
  } catch {
    return failure({ code: 'invalid_input' });
  }
  try {
    const created = await (dependencies.gateway ?? (await defaultGateway())).create({
      ...parsed.data,
      responses,
      submissionKeyDigest: createHash('sha256')
        .update(`staff-registration\u0000${parsed.data.idempotencyKey}`)
        .digest('hex'),
    });
    if (!['created', 'replayed'].includes(created.outcome)) {
      if (created.outcome === 'idempotency_conflict')
        return failure({ code: 'idempotency_conflict' });
      return failure({ code: created.outcome === 'not_found' ? 'not_found' : 'invalid_input' });
    }
    if (!created.registrationId || !created.athleteId) return failure({ code: 'unavailable' });
    return success({
      registrationId: created.registrationId,
      athleteId: created.athleteId,
      replayed: created.outcome === 'replayed',
    });
  } catch {
    return failure({ code: 'unavailable' });
  }
}
