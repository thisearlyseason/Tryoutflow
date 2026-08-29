import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type {
  ChangeDecisionGateway,
  CreateRosterDraftGateway,
  CreateRosterOutcome,
  FinalizeRosterGateway,
  MoveAthleteGateway,
  ReviseRosterGateway,
  ReviseRosterOutcome,
  RosterGateway,
  VersionedRosterOutcome,
} from '../application/contracts';

type RpcError = { code?: unknown } | null;
const uuid = z.uuid();
const version = z.number().int().safe().positive();

function singleRow<T>(data: unknown, schema: z.ZodType<T>): T | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const parsed = schema.safeParse(data[0]);
  return parsed.success ? parsed.data : null;
}

const createRow = z.strictObject({
  outcome: z.enum(['created', 'forbidden', 'invalid_scope', 'invalid_teams', 'conflict']),
  roster_version_id: uuid.nullable(),
  version: version.nullable(),
});
export function mapCreateRosterResponse(data: unknown, error: RpcError): CreateRosterOutcome {
  if (error?.code === '42501') return { outcome: 'forbidden' };
  if (error) return { outcome: 'unexpected' };
  const row = singleRow(data, createRow);
  if (!row) return { outcome: 'unexpected' };
  if (row.outcome === 'created')
    return row.roster_version_id && row.version
      ? { outcome: 'created', rosterVersionId: row.roster_version_id, version: row.version }
      : { outcome: 'unexpected' };
  return { outcome: row.outcome };
}

const versionedRow = z.strictObject({
  outcome: z.string(),
  version: version.nullable(),
});
function mapVersioned<TSuccess extends 'moved' | 'changed' | 'finalized'>(
  success: TSuccess,
  allowed: readonly string[],
  data: unknown,
  error: RpcError,
): VersionedRosterOutcome<TSuccess> {
  if (error?.code === '42501') return { outcome: 'forbidden' };
  if (error) return { outcome: 'unexpected' };
  const row = singleRow(data, versionedRow);
  if (!row || !allowed.includes(row.outcome)) return { outcome: 'unexpected' };
  if (row.outcome === success)
    return row.version ? { outcome: success, version: row.version } : { outcome: 'unexpected' };
  if (row.outcome === 'unchanged')
    return row.version ? { outcome: 'unchanged', version: row.version } : { outcome: 'unexpected' };
  return row.version
    ? {
        outcome: row.outcome as Exclude<
          VersionedRosterOutcome<TSuccess>,
          { outcome: TSuccess }
        >['outcome'],
        version: row.version,
      }
    : {
        outcome: row.outcome as Exclude<
          VersionedRosterOutcome<TSuccess>,
          { outcome: TSuccess }
        >['outcome'],
      };
}

const reviseRow = z.strictObject({
  outcome: z.enum([
    'revised',
    'forbidden',
    'confirmation_required',
    'invalid_reason',
    'invalid_roster',
    'invalid_state',
    'conflict',
    'capacity',
  ]),
  roster_version_id: uuid.nullable(),
  version: version.nullable(),
});
export function mapReviseRosterResponse(data: unknown, error: RpcError): ReviseRosterOutcome {
  if (error?.code === '42501') return { outcome: 'forbidden' };
  if (error) return { outcome: 'unexpected' };
  const row = singleRow(data, reviseRow);
  if (!row) return { outcome: 'unexpected' };
  if (row.outcome === 'revised')
    return row.roster_version_id && row.version
      ? { outcome: 'revised', rosterVersionId: row.roster_version_id, version: row.version }
      : { outcome: 'unexpected' };
  if (row.outcome === 'conflict')
    return row.version ? { outcome: 'conflict', version: row.version } : { outcome: 'unexpected' };
  return { outcome: row.outcome };
}

export class SupabaseRosterGateway implements RosterGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async create(input: Parameters<CreateRosterDraftGateway['create']>[0]) {
    const { data, error } = await this.client.rpc('create_roster_draft', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_teams: input.teams,
    });
    return mapCreateRosterResponse(data, error);
  }

  async move(input: Parameters<MoveAthleteGateway['move']>[0]) {
    const { data, error } = await this.client.rpc('move_roster_athlete', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_roster_version_id: input.rosterVersionId,
      p_registration_id: input.registrationId,
      p_team_id: input.teamId,
      p_expected_version: input.expectedVersion,
    });
    return mapVersioned(
      'moved',
      [
        'moved',
        'unchanged',
        'forbidden',
        'invalid_roster',
        'invalid_state',
        'invalid_registration',
        'invalid_team',
        'conflict',
      ],
      data,
      error,
    );
  }

  async change(input: Parameters<ChangeDecisionGateway['change']>[0]) {
    const { data, error } = await this.client.rpc('change_roster_decisions', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_roster_version_id: input.rosterVersionId,
      p_changes: input.changes,
      p_expected_version: input.expectedVersion,
      p_confirmation: input.confirmation,
    });
    return mapVersioned(
      'changed',
      [
        'changed',
        'unchanged',
        'forbidden',
        'confirmation_required',
        'invalid_roster',
        'invalid_state',
        'invalid_registration',
        'invalid_decisions',
        'conflict',
      ],
      data,
      error,
    );
  }

  async finalize(input: Parameters<FinalizeRosterGateway['finalize']>[0]) {
    const { data, error } = await this.client.rpc('finalize_roster_version', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_roster_version_id: input.rosterVersionId,
      p_expected_version: input.expectedVersion,
      p_confirmation: input.confirmation,
    });
    return mapVersioned(
      'finalized',
      [
        'finalized',
        'forbidden',
        'confirmation_required',
        'invalid_roster',
        'invalid_state',
        'conflict',
      ],
      data,
      error,
    );
  }

  async revise(input: Parameters<ReviseRosterGateway['revise']>[0]) {
    const { data, error } = await this.client.rpc('revise_roster_version', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_roster_version_id: input.rosterVersionId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
      p_confirmation: input.confirmation,
    });
    return mapReviseRosterResponse(data, error);
  }
}
