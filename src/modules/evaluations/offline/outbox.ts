import type { EvaluationDraftPayload, EvaluationStorageScope } from './database';
import {
  createEvaluationOfflineRepository,
  EvaluationOfflineError,
  type EvaluationMutationInput,
} from './repository';

export type { EvaluationDraftPayload, EvaluationStorageScope } from './database';
export type { EvaluationSyncState } from './sync-state';
export type { EvaluationMutationInput } from './repository';
export { createEvaluationOfflineRepository, EvaluationOfflineError } from './repository';

export type EvaluationOutboxEntry = Awaited<
  ReturnType<ReturnType<typeof createEvaluationOfflineRepository>['enqueueEvaluationMutation']>
>;

let defaultRepository: ReturnType<typeof createEvaluationOfflineRepository> | null = null;

function repository() {
  defaultRepository ??= createEvaluationOfflineRepository();
  return defaultRepository;
}

/**
 * Notes, tags, and flags are sensitive evaluator data. IndexedDB is same-origin
 * device storage, not encrypted vault storage: shared device/browser profiles and
 * compromised same-origin scripts can read it. Call teardown only after all work
 * is acknowledged, and rely on the bounded retention implemented by the repository.
 */
export async function saveDraftLocally(
  input: {
    scope: EvaluationStorageScope;
    evaluationId: string | null;
    expectedVersion: number;
    draft: EvaluationDraftPayload;
  },
  options?: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['saveDraftLocally']>[1],
) {
  return repository().saveDraftLocally(input, options);
}

export async function enqueueEvaluationMutation(
  input: EvaluationMutationInput,
  options?: Parameters<
    ReturnType<typeof createEvaluationOfflineRepository>['enqueueEvaluationMutation']
  >[1],
) {
  return repository().enqueueEvaluationMutation(input, options);
}

export async function nextPendingMutation(
  options?: Parameters<
    ReturnType<typeof createEvaluationOfflineRepository>['nextPendingMutation']
  >[0],
) {
  return repository().nextPendingMutation(options);
}

export async function acknowledgeMutation(
  input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['acknowledgeMutation']>[0],
) {
  return repository().acknowledgeMutation(input);
}

export async function markNeedsAttention(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['markNeedsAttention']>
) {
  return repository().markNeedsAttention(...input);
}

export async function recordMutationFailure(
  ...input: Parameters<
    ReturnType<typeof createEvaluationOfflineRepository>['recordMutationFailure']
  >
) {
  return repository().recordMutationFailure(...input);
}

export async function clearAcknowledged(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['clearAcknowledged']>
) {
  return repository().clearAcknowledged(...input);
}

export async function cleanupExpired(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['cleanupExpired']>
) {
  return repository().cleanupExpired(...input);
}
