import type { EvaluationDraftPayload, EvaluationStorageScope } from './database';
import {
  createEvaluationOfflineRepository,
  EvaluationOfflineError,
  type EvaluationMutationInput,
  type RepositoryOptions,
} from './repository';

export type { EvaluationDraftPayload, EvaluationStorageScope } from './database';
export { evaluationDatabaseName } from './database';
export type { EvaluationSyncState } from './sync-state';
export type {
  EvaluationMutationInput,
  EvaluationOfflineQuotas,
  EvaluationQuotaName,
} from './repository';
export { createEvaluationOfflineRepository, EvaluationOfflineError } from './repository';

export type EvaluationOutboxEntry = Awaited<
  ReturnType<ReturnType<typeof createEvaluationOfflineRepository>['enqueueEvaluationMutation']>
>;

let defaultRepository: ReturnType<typeof createEvaluationOfflineRepository> | null = null;

/**
 * Bind the module API to the current authenticated user. A changed identity
 * closes the previous IndexedDB handle before opening the user's physical DB.
 * Call with the authoritative auth-session UUID, never a route or form value.
 */
export function bindEvaluationOfflineUser(
  authenticatedUserId: string,
  options: Omit<RepositoryOptions, 'authenticatedUserId'> = {},
): void {
  const previousRepository = defaultRepository;
  defaultRepository = null;
  previousRepository?.close();
  defaultRepository = createEvaluationOfflineRepository({ ...options, authenticatedUserId });
}

export function resetEvaluationOfflineUser(): void {
  defaultRepository?.close();
  defaultRepository = null;
}

function repository() {
  if (!defaultRepository) {
    throw new EvaluationOfflineError(
      'user_not_bound',
      'Bind offline evaluation storage to the authenticated user before use.',
    );
  }
  return defaultRepository;
}

/**
 * Evaluation notes/tags/flags remain sensitive same-origin device data. Physical
 * per-user databases prevent accidental account crossover, but do not protect a
 * shared browser profile from local OS users or compromised same-origin script.
 * Keep CSP/dependency controls and explicit sign-out retention UX as release gates.
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

export async function saveSessionContext(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['saveSessionContext']>
) {
  return repository().saveSessionContext(...input);
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
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['nextPendingMutation']>
) {
  return repository().nextPendingMutation(...input);
}

export async function acknowledgeMutation(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['acknowledgeMutation']>
) {
  return repository().acknowledgeMutation(...input);
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

export async function resolveNeedsAttention(
  ...input: Parameters<
    ReturnType<typeof createEvaluationOfflineRepository>['resolveNeedsAttention']
  >
) {
  return repository().resolveNeedsAttention(...input);
}

export async function listMutations(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['listMutations']>
) {
  return repository().listMutations(...input);
}

export async function getReceipt(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['getReceipt']>
) {
  return repository().getReceipt(...input);
}

export async function getSyncState(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['getSyncState']>
) {
  return repository().getSyncState(...input);
}

export async function clearAcknowledged(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['clearAcknowledged']>
) {
  return repository().clearAcknowledged(...input);
}

export async function teardownScope(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['teardownScope']>
) {
  return repository().teardownScope(...input);
}

export async function cleanupExpired(
  ...input: Parameters<ReturnType<typeof createEvaluationOfflineRepository>['cleanupExpired']>
) {
  return repository().cleanupExpired(...input);
}
