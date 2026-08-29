import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type {
  CompleteEvaluationGateway,
  ConfigureEvaluationNoteTagGateway,
  ConfigureTagOutcome,
  DirectorFlagGateway,
  DirectorFlagOutcome,
  EvaluationGateway,
  LifecycleOutcome,
  LockEvaluationGateway,
  ReopenEvaluationGateway,
  SaveEvaluationGateway,
  SaveOutcome,
} from '../application/contracts';

type RpcError = { code?: unknown } | null;

const uuid = z.uuid();
const version = z.number().int().positive();

function singleRow<T>(data: unknown, schema: z.ZodType<T>): T | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const parsed = schema.safeParse(data[0]);
  return parsed.success ? parsed.data : null;
}

const saveRow = z.strictObject({
  outcome: z.enum([
    'saved',
    'forbidden',
    'invalid_context',
    'invalid_score',
    'invalid_note_tag',
    'locked',
    'conflict',
  ]),
  evaluation_id: uuid.nullable(),
  version: version.nullable(),
});

export function mapSaveResponse(data: unknown, error: RpcError): SaveOutcome {
  if (error?.code === '42501') return { outcome: 'forbidden' };
  if (error) return { outcome: 'unexpected' };
  const row = singleRow(data, saveRow);
  if (!row) return { outcome: 'unexpected' };
  if (row.outcome === 'saved') {
    return row.evaluation_id && row.version
      ? { outcome: 'saved', evaluationId: row.evaluation_id, version: row.version }
      : { outcome: 'unexpected' };
  }
  return { outcome: row.outcome };
}

function lifecycleMapper<TSuccess extends 'completed' | 'reopened' | 'locked'>(
  successOutcome: TSuccess,
  failureOutcomes: readonly string[],
) {
  const rowSchema = z.strictObject({ outcome: z.string(), version: version.nullable() });
  return (data: unknown, error: RpcError): LifecycleOutcome<TSuccess> => {
    if (error?.code === '42501') return { outcome: 'forbidden' };
    if (error) return { outcome: 'unexpected' };
    const row = singleRow(data, rowSchema);
    if (!row) return { outcome: 'unexpected' };
    if (row.outcome === successOutcome) {
      return row.version
        ? { outcome: successOutcome, version: row.version }
        : { outcome: 'unexpected' };
    }
    if (failureOutcomes.includes(row.outcome)) {
      return {
        outcome: row.outcome as Exclude<LifecycleOutcome<TSuccess>, { version: number }>['outcome'],
      };
    }
    return { outcome: 'unexpected' };
  };
}

export const mapCompleteResponse = lifecycleMapper('completed', [
  'forbidden',
  'required_scores_missing',
  'locked',
  'conflict',
]);
export const mapReopenResponse = lifecycleMapper('reopened', [
  'forbidden',
  'invalid_reason',
  'invalid_state',
  'conflict',
]);
export const mapLockResponse = lifecycleMapper('locked', [
  'forbidden',
  'invalid_state',
  'conflict',
]);

const configureTagRow = z.strictObject({
  outcome: z.enum(['saved', 'forbidden', 'invalid_tag', 'conflict']),
  note_tag_id: uuid.nullable(),
});
export function mapConfigureTagResponse(data: unknown, error: RpcError): ConfigureTagOutcome {
  if (error?.code === '42501') return { outcome: 'forbidden' };
  if (error) return { outcome: 'unexpected' };
  const row = singleRow(data, configureTagRow);
  if (!row) return { outcome: 'unexpected' };
  if (row.outcome === 'saved') {
    return row.note_tag_id
      ? { outcome: 'saved', noteTagId: row.note_tag_id }
      : { outcome: 'unexpected' };
  }
  return { outcome: row.outcome };
}

const directorFlagRow = z.strictObject({
  outcome: z.enum(['saved', 'revoked', 'forbidden', 'invalid_flag', 'conflict']),
  athlete_flag_id: uuid.nullable(),
});
export function mapDirectorFlagResponse(data: unknown, error: RpcError): DirectorFlagOutcome {
  if (error?.code === '42501') return { outcome: 'forbidden' };
  if (error) return { outcome: 'unexpected' };
  const row = singleRow(data, directorFlagRow);
  if (!row) return { outcome: 'unexpected' };
  if (row.outcome === 'saved' || row.outcome === 'revoked') {
    return row.athlete_flag_id
      ? { outcome: row.outcome, athleteFlagId: row.athlete_flag_id }
      : { outcome: 'unexpected' };
  }
  return { outcome: row.outcome };
}

export class SupabaseEvaluationGateway implements EvaluationGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async save(input: Parameters<SaveEvaluationGateway['save']>[0]): Promise<SaveOutcome> {
    const { data, error } = await this.client.rpc('save_evaluation_draft', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_registration_id: input.registrationId,
      p_session_id: input.sessionId,
      p_group_id: input.groupId,
      p_rubric_version_id: input.rubricVersionId,
      p_expected_version: input.expectedVersion,
      p_scores: input.scores,
      p_note: input.note ?? null,
      p_note_tag_ids: input.noteTagIds ?? [],
      p_flags: input.flags ?? [],
    });
    return mapSaveResponse(data, error);
  }

  async complete(
    input: Parameters<CompleteEvaluationGateway['complete']>[0],
  ): Promise<LifecycleOutcome<'completed'>> {
    const { data, error } = await this.client.rpc('complete_evaluation', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_session_id: input.sessionId,
      p_group_id: input.groupId,
      p_evaluation_id: input.evaluationId,
      p_expected_version: input.expectedVersion,
    });
    return mapCompleteResponse(data, error);
  }

  async reopen(
    input: Parameters<ReopenEvaluationGateway['reopen']>[0],
  ): Promise<LifecycleOutcome<'reopened'>> {
    const { data, error } = await this.client.rpc('reopen_evaluation', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_session_id: input.sessionId,
      p_group_id: input.groupId,
      p_evaluation_id: input.evaluationId,
      p_expected_version: input.expectedVersion,
      p_reason: input.reason,
    });
    return mapReopenResponse(data, error);
  }

  async lock(
    input: Parameters<LockEvaluationGateway['lock']>[0],
  ): Promise<LifecycleOutcome<'locked'>> {
    const { data, error } = await this.client.rpc('lock_evaluation', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_session_id: input.sessionId,
      p_group_id: input.groupId,
      p_evaluation_id: input.evaluationId,
      p_expected_version: input.expectedVersion,
    });
    return mapLockResponse(data, error);
  }

  async configure(
    input: Parameters<ConfigureEvaluationNoteTagGateway['configure']>[0],
  ): Promise<ConfigureTagOutcome> {
    const { data, error } = await this.client.rpc('configure_evaluation_note_tag', {
      p_organization_id: input.organizationId,
      p_note_tag_id: input.noteTagId,
      p_label: input.label,
      p_active: input.active,
    });
    return mapConfigureTagResponse(data, error);
  }

  async manage(input: Parameters<DirectorFlagGateway['manage']>[0]): Promise<DirectorFlagOutcome> {
    const { data, error } = await this.client.rpc('manage_director_evaluation_flag', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_division_id: input.divisionId,
      p_registration_id: input.registrationId,
      p_session_id: input.sessionId,
      p_group_id: input.groupId,
      p_flag_id: input.flagId,
      p_action: input.action,
      p_flag_type: input.flagType,
    });
    return mapDirectorFlagResponse(data, error);
  }
}
