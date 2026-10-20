import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type { AssignedAthleteGateway } from '../application/list-assigned-athletes';
import type { AssignedAthleteSummary } from '../domain/assignment';

const rowSchema = z.strictObject({
  registration_id: z.uuid(),
  division_id: z.uuid(),
  session_id: z.uuid().nullable(),
  group_id: z.uuid().nullable(),
  display_name: z.string().trim().min(1).max(200),
  division_name: z.string().trim().min(1).max(120),
  session_name: z.string().trim().min(1).max(120).nullable(),
  group_name: z.string().trim().min(1).max(120).nullable(),
  tryout_number: z.number().int().positive().nullable(),
  identity_mode: z.enum(['blind', 'full']),
});

export function parseAssignedAthleteRows(input: unknown): AssignedAthleteSummary[] {
  const parsed = z.array(rowSchema).safeParse(input);
  if (!parsed.success) throw new Error('Invalid assigned-athlete projection');
  return parsed.data.map((row) => ({
    registrationId: row.registration_id,
    divisionId: row.division_id,
    sessionId: row.session_id,
    groupId: row.group_id,
    displayName: row.display_name,
    divisionName: row.division_name,
    sessionName: row.session_name,
    groupName: row.group_name,
    tryoutNumber: row.tryout_number,
    identityMode: row.identity_mode,
  }));
}

export class SupabaseAssignedAthleteGateway implements AssignedAthleteGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async list(input: {
    organizationId: string;
    tryoutId: string;
    evaluatorUserId: string;
  }): Promise<AssignedAthleteSummary[]> {
    const { data, error } = await this.client.rpc('list_assigned_athletes', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
    });
    if (error) throw error;
    return parseAssignedAthleteRows(data);
  }
}
