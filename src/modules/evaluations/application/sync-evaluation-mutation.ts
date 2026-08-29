import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../../infrastructure/supabase/database.types';
import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import {
  evaluationMutationReceiptSchema,
  evaluationMutationSchema,
  type EvaluationMutation,
  type EvaluationMutationReceipt,
} from './evaluation-mutation-contract';

export {
  evaluationMutationReceiptSchema,
  evaluationMutationSchema,
  type EvaluationMutation,
  type EvaluationMutationReceipt,
} from './evaluation-mutation-contract';
export type EvaluationMutationGateway = {
  sync(input: EvaluationMutation): Promise<EvaluationMutationReceipt>;
};
export type EvaluationSyncError = {
  code: 'invalid_input' | 'forbidden' | 'mutation_id_conflict' | 'unexpected';
};

export class SupabaseEvaluationMutationGateway implements EvaluationMutationGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async sync(input: EvaluationMutation): Promise<EvaluationMutationReceipt> {
    const response = await this.client.rpc('sync_evaluation_mutation', {
      p_organization_id: input.scope.organizationId,
      p_tryout_id: input.scope.tryoutId,
      p_session_id: input.scope.sessionId,
      p_registration_id: input.scope.registrationId,
      p_rubric_version_id: input.scope.rubricVersionId,
      p_evaluation_id: input.evaluationId,
      p_client_mutation_id: input.clientMutationId,
      p_expected_version: input.expectedVersion,
      p_draft: input.draft as Json,
    });
    if (response.error) {
      if (response.error.code === 'TF409') throw new Error('mutation_id_conflict');
      throw new Error('sync_failed');
    }
    const parsed = evaluationMutationReceiptSchema.safeParse(response.data?.[0]?.receipt);
    if (!parsed.success) throw new Error('invalid_receipt');
    return parsed.data;
  }
}

export async function syncEvaluationMutation(
  input: unknown,
  evaluator: AuthorizationContext,
  dependencies: { gateway?: EvaluationMutationGateway } = {},
): Promise<AppResult<EvaluationMutationReceipt, EvaluationSyncError>> {
  const parsed = evaluationMutationSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const mutation = parsed.data;
  if (
    mutation.scope.userId !== evaluator.userId ||
    mutation.scope.evaluatorId !== evaluator.userId ||
    mutation.scope.organizationId !== evaluator.organizationId ||
    !requireCapability(evaluator, 'evaluation:update-own', {
      organizationId: evaluator.organizationId,
      tryoutId: mutation.scope.tryoutId,
      sessionId: mutation.scope.sessionId,
      evaluatorUserId: evaluator.userId,
    }).ok
  ) {
    return failure({ code: 'forbidden' });
  }
  try {
    const gateway =
      dependencies.gateway ??
      new SupabaseEvaluationMutationGateway(await createServerSupabaseClient());
    return success(await gateway.sync(mutation));
  } catch (error) {
    return failure({
      code:
        error instanceof Error && error.message === 'mutation_id_conflict'
          ? 'mutation_id_conflict'
          : 'unexpected',
    });
  }
}
