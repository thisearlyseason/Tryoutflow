import Dexie, { type Transaction } from 'dexie';
import { z } from 'zod';

import {
  DEFAULT_EVALUATION_OFFLINE_DATABASE,
  EvaluationOfflineDatabase,
  digestValue,
  evaluationDatabaseName,
  evaluationDraftSchema,
  evaluationPayload,
  evaluationQueueKey,
  evaluationScopeSchema,
  scopeKey,
  storedDraftSchema,
  storedMutationSchema,
  storedQuarantineSchema,
  storedReceiptSchema,
  storedSessionContextSchema,
  type EvaluationDraftPayload,
  type EvaluationStorageScope,
  type QuarantineReason,
  type QuarantineSource,
  type StoredEvaluationDraft,
  type StoredEvaluationMutation,
  type StoredEvaluationQuarantine,
  type StoredEvaluationReceipt,
  type StoredSessionContext,
} from './database';
import type { EvaluationSyncState } from './sync-state';

const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const LEASE_MS = 30_000;
const MAX_DRAFT_BYTES = 64 * 1_024;
const MAX_RETRY_ATTEMPTS = 5;
const uuid = z.uuid();

export type EvaluationMutationInput = {
  scope: EvaluationStorageScope;
  evaluationId: string;
  clientMutationId?: string;
  expectedVersion: number;
  draft: EvaluationDraftPayload;
};

export type EvaluationMutationFailureCategory =
  | 'network'
  | 'server'
  | 'conflict'
  | 'forbidden'
  | 'invalid_rubric'
  | 'retry_exhausted'
  | 'corrupt_record';

export type EvaluationQuotaName =
  | 'contexts'
  | 'drafts'
  | 'mutations'
  | 'unacknowledged_mutations'
  | 'acknowledged_mutations'
  | 'receipts'
  | 'quarantines'
  | 'bytes';

export type EvaluationOfflineQuotas = {
  maxContexts: number;
  maxDrafts: number;
  maxMutations: number;
  maxUnacknowledgedMutations: number;
  maxAcknowledgedMutations: number;
  maxReceipts: number;
  maxQuarantines: number;
  maxBytes: number;
};

const DEFAULT_QUOTAS: EvaluationOfflineQuotas = {
  maxContexts: 200,
  maxDrafts: 1_000,
  maxMutations: 2_000,
  maxUnacknowledgedMutations: 1_000,
  maxAcknowledgedMutations: 1_000,
  maxReceipts: 2_000,
  maxQuarantines: 500,
  maxBytes: 16 * 1_024 * 1_024,
};

export type EvaluationOfflineErrorCode =
  | 'storage_unavailable'
  | 'invalid_input'
  | 'user_not_bound'
  | 'user_mismatch'
  | 'context_not_found'
  | 'quota_exceeded'
  | 'storage_limit'
  | 'storage_read_failed'
  | 'storage_write_failed'
  | 'storage_cleanup_failed'
  | 'mutation_id_conflict'
  | 'mutation_not_found'
  | 'receipt_mismatch'
  | 'lease_mismatch'
  | 'lease_expired'
  | 'invalid_transition'
  | 'corrupt_record';

export class EvaluationOfflineError extends Error {
  readonly quota?: EvaluationQuotaName;

  constructor(
    public readonly code: EvaluationOfflineErrorCode,
    message: string,
    details: { cause?: unknown; quota?: EvaluationQuotaName } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'EvaluationOfflineError';
    this.quota = details.quota;
  }
}

export type RepositoryOptions = {
  authenticatedUserId: string;
  databaseName?: string;
  indexedDB?: IDBFactory | null;
  keyRange?: typeof IDBKeyRange | null;
  quotas?: Partial<EvaluationOfflineQuotas>;
};

type OperationTime = {
  now?: Date;
  onSyncState?: (state: EvaluationSyncState) => void;
  onCallbackError?: (error: unknown) => void;
};

type ClaimOptions = { now?: Date; leaseDurationMs?: number };
type StorageOperation = 'read' | 'write' | 'cleanup';
type AllTablesTransaction = Transaction;

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function mapStorageError(error: unknown, operation: StorageOperation): EvaluationOfflineError {
  if (error instanceof EvaluationOfflineError) return error;
  const hasName = (value: unknown, expected: string, depth = 0): boolean => {
    if (!value || typeof value !== 'object' || depth > 5) return false;
    const candidate = value as {
      name?: unknown;
      cause?: unknown;
      inner?: unknown;
      innerError?: unknown;
    };
    return (
      candidate.name === expected ||
      hasName(candidate.cause, expected, depth + 1) ||
      hasName(candidate.inner, expected, depth + 1) ||
      hasName(candidate.innerError, expected, depth + 1)
    );
  };
  if (hasName(error, 'QuotaExceededError')) {
    return new EvaluationOfflineError(
      'storage_limit',
      'The browser refused evaluation storage because device quota is exhausted.',
      { cause: error },
    );
  }
  const code =
    operation === 'read'
      ? 'storage_read_failed'
      : operation === 'cleanup'
        ? 'storage_cleanup_failed'
        : 'storage_write_failed';
  const message =
    operation === 'read'
      ? 'Evaluation device storage could not be read.'
      : operation === 'cleanup'
        ? 'Evaluation device storage cleanup did not commit.'
        : 'Evaluation device storage did not commit.';
  return new EvaluationOfflineError(code, message, { cause: error });
}

function notify(options: OperationTime, state: EvaluationSyncState): void {
  try {
    options.onSyncState?.(state);
  } catch (error) {
    try {
      options.onCallbackError?.(error);
    } catch {
      // Consumer callbacks are observability only and never redefine durability.
    }
  }
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function quotaError(quota: EvaluationQuotaName): EvaluationOfflineError {
  return new EvaluationOfflineError(
    'quota_exceeded',
    `The per-user offline ${quota} quota is full. Existing work was retained.`,
    { quota },
  );
}

function safeDate(value: Date): Date {
  if (Number.isNaN(value.getTime()))
    throw new EvaluationOfflineError('invalid_input', 'Invalid operation timestamp.');
  return value;
}

function safeDiagnostic(value: string): string {
  return value.slice(0, 500);
}

function receiptPayload(receipt: Omit<StoredEvaluationReceipt, 'receiptDigest'>) {
  return receipt;
}

export class EvaluationOfflineRepository {
  readonly databaseName: string;
  private readonly quotas: EvaluationOfflineQuotas;

  constructor(
    private readonly database: EvaluationOfflineDatabase,
    private readonly authenticatedUserId: string,
    private readonly indexedDbFactory: IDBFactory,
    private readonly keyRangeFactory: typeof IDBKeyRange,
    quotas: Partial<EvaluationOfflineQuotas> = {},
  ) {
    this.databaseName = database.name;
    this.quotas = { ...DEFAULT_QUOTAS, ...quotas };
  }

  close(): void {
    this.database.close({ disableAutoOpen: true });
  }

  private parseScope(value: EvaluationStorageScope): EvaluationStorageScope {
    const parsed = evaluationScopeSchema.safeParse(value);
    if (!parsed.success)
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation storage scope.');
    if (parsed.data.userId !== this.authenticatedUserId) {
      throw new EvaluationOfflineError(
        'user_mismatch',
        'The evaluation repository is bound to a different authenticated user.',
      );
    }
    return parsed.data;
  }

  private parseDraft(value: EvaluationDraftPayload): EvaluationDraftPayload {
    const parsed = evaluationDraftSchema.safeParse(value);
    if (!parsed.success)
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation draft.');
    if (encodedBytes(parsed.data) > MAX_DRAFT_BYTES) throw quotaError('bytes');
    return structuredClone(parsed.data);
  }

  private assertDraftMatchesContext(
    draft: EvaluationDraftPayload,
    context: StoredSessionContext,
  ): void {
    const categories = new Map(context.categories.map((category) => [category.id, category]));
    for (const score of draft.scores) {
      const category = categories.get(score.categoryId);
      if (!category || score.value < category.scaleMin || score.value > category.scaleMax) {
        throw new EvaluationOfflineError(
          'invalid_input',
          'Draft scores do not match the stored rubric context.',
        );
      }
    }
  }

  private async allUsage(transaction: AllTablesTransaction) {
    const [contexts, drafts, mutations, receipts, quarantines] = await Promise.all([
      transaction.table('sessionContexts').toArray(),
      transaction.table('drafts').toArray(),
      transaction.table('mutations').toArray(),
      transaction.table('receipts').toArray(),
      transaction.table('quarantines').toArray(),
    ]);
    return { contexts, drafts, mutations, receipts, quarantines };
  }

  private async assertByteQuota(
    transaction: AllTablesTransaction,
    candidate: unknown,
  ): Promise<void> {
    const usage = await this.allUsage(transaction);
    if (encodedBytes(usage) + encodedBytes(candidate) > this.quotas.maxBytes)
      throw quotaError('bytes');
  }

  private makeQuarantine(
    sourceTable: QuarantineSource,
    raw: unknown,
    reason: QuarantineReason,
    diagnostic: string,
    now: Date,
  ): StoredEvaluationQuarantine {
    const rawObject = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const parsedScope = evaluationScopeSchema.safeParse(rawObject.scope);
    const trustedScopeKey =
      parsedScope.success && parsedScope.data.userId === this.authenticatedUserId
        ? scopeKey(parsedScope.data)
        : undefined;
    const sourceKeyCandidate =
      sourceTable === 'mutations' || sourceTable === 'receipts'
        ? (rawObject.storageKey ?? rawObject.clientMutationId)
        : rawObject.scopeKey;
    return {
      quarantineKey: crypto.randomUUID(),
      ...(trustedScopeKey ? { scopeKey: trustedScopeKey } : {}),
      sourceTable,
      sourceKey: typeof sourceKeyCandidate === 'string' ? sourceKeyCandidate.slice(0, 600) : '',
      reason,
      diagnostic: safeDiagnostic(diagnostic),
      status: 'needs_attention',
      createdAt: now.toISOString(),
      originalRecord: structuredClone(raw),
    };
  }

  private async moveToQuarantine(
    transaction: AllTablesTransaction,
    sourceTable: QuarantineSource,
    raw: unknown,
    reason: QuarantineReason,
    diagnostic: string,
    now: Date,
  ): Promise<void> {
    const quarantineRecord = this.makeQuarantine(sourceTable, raw, reason, diagnostic, now);
    const quarantineCount = await transaction.table('quarantines').count();
    if (quarantineCount >= this.quotas.maxQuarantines) throw quotaError('quarantines');
    await transaction.table('quarantines').add(quarantineRecord);
    const key = quarantineRecord.sourceKey;
    if (key) await transaction.table(sourceTable).delete(key);
  }

  private async addToQuarantine(
    transaction: AllTablesTransaction,
    sourceTable: QuarantineSource,
    raw: unknown,
    reason: QuarantineReason,
    diagnostic: string,
    now: Date,
  ): Promise<void> {
    const quarantineRecord = this.makeQuarantine(sourceTable, raw, reason, diagnostic, now);
    if ((await transaction.table('quarantines').count()) >= this.quotas.maxQuarantines) {
      throw quotaError('quarantines');
    }
    await transaction.table('quarantines').add(quarantineRecord);
  }

  private async validateContext(
    raw: unknown,
    expectedScope: EvaluationStorageScope,
  ): Promise<StoredSessionContext> {
    const parsed = storedSessionContextSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.scopeKey !== scopeKey(expectedScope) ||
      parsed.data.scope.userId !== this.authenticatedUserId
    ) {
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored rubric context failed validation.',
      );
    }
    return parsed.data;
  }

  private async validateDraftRecord(
    raw: unknown,
    expectedScope: EvaluationStorageScope,
  ): Promise<StoredEvaluationDraft> {
    const parsed = storedDraftSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.scopeKey !== scopeKey(expectedScope) ||
      parsed.data.scope.userId !== this.authenticatedUserId
    ) {
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored evaluation draft failed validation.',
      );
    }
    const expectedDigest = await Dexie.waitFor(
      digestValue(
        evaluationPayload(
          parsed.data.scope,
          parsed.data.evaluationId,
          parsed.data.expectedVersion,
          parsed.data.draft,
        ),
      ),
    );
    if (expectedDigest !== parsed.data.payloadDigest)
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored evaluation draft digest does not match.',
      );
    return parsed.data;
  }

  private async validateMutationRecord(raw: unknown): Promise<StoredEvaluationMutation> {
    const parsed = storedMutationSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.scope.userId !== this.authenticatedUserId ||
      parsed.data.scopeKey !== scopeKey(parsed.data.scope) ||
      parsed.data.storageKey !== `${scopeKey(parsed.data.scope)}|${parsed.data.clientMutationId}` ||
      parsed.data.queueKey !== evaluationQueueKey(parsed.data.scope, parsed.data.evaluationId)
    ) {
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored evaluation mutation failed validation.',
      );
    }
    const expectedDigest = await Dexie.waitFor(
      digestValue(
        evaluationPayload(
          parsed.data.scope,
          parsed.data.evaluationId,
          parsed.data.expectedVersion,
          parsed.data.draft,
        ),
      ),
    );
    if (expectedDigest !== parsed.data.payloadDigest)
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored evaluation mutation digest does not match.',
      );
    return parsed.data;
  }

  private async validateReceiptRecord(raw: unknown): Promise<StoredEvaluationReceipt> {
    const parsed = storedReceiptSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.scope.userId !== this.authenticatedUserId ||
      parsed.data.scopeKey !== scopeKey(parsed.data.scope) ||
      parsed.data.storageKey !== `${scopeKey(parsed.data.scope)}|${parsed.data.clientMutationId}`
    ) {
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored evaluation receipt failed validation.',
      );
    }
    const { receiptDigest, ...payload } = parsed.data;
    const expectedDigest = await Dexie.waitFor(digestValue(receiptPayload(payload)));
    if (receiptDigest !== expectedDigest) {
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored evaluation receipt digest does not match.',
      );
    }
    return parsed.data;
  }

  private async requireContext(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
  ): Promise<StoredSessionContext> {
    const raw = await transaction.table('sessionContexts').get(scopeKey(scope));
    if (!raw)
      throw new EvaluationOfflineError(
        'context_not_found',
        'The exact offline rubric context is not stored for this scope.',
      );
    return this.validateContext(raw, scope);
  }

  private allTables() {
    return [
      this.database.sessionContexts,
      this.database.drafts,
      this.database.mutations,
      this.database.receipts,
      this.database.quarantines,
    ] as const;
  }

  async saveSessionContext(
    input: Omit<StoredSessionContext, 'scopeKey' | 'expiresAt'>,
    options: OperationTime = {},
  ): Promise<StoredSessionContext> {
    const scope = this.parseScope(input.scope);
    const now = safeDate(options.now ?? new Date());
    const candidate = storedSessionContextSchema.safeParse({
      ...input,
      scope,
      scopeKey: scopeKey(scope),
      expiresAt: addMilliseconds(now, DRAFT_TTL_MS),
    });
    if (!candidate.success)
      throw new EvaluationOfflineError('invalid_input', 'Invalid bounded session context.');
    try {
      const result = await this.database.transaction(
        'rw',
        ...this.allTables(),
        async (transaction) => {
          const exists = await this.database.sessionContexts.get(candidate.data.scopeKey);
          if (exists) {
            try {
              await this.validateContext(exists, scope);
            } catch {
              await this.moveToQuarantine(
                transaction,
                'sessionContexts',
                exists,
                'invalid_record',
                'A malformed stored context was retained before replacement.',
                now,
              );
            }
          }
          if (!exists && (await this.database.sessionContexts.count()) >= this.quotas.maxContexts)
            throw quotaError('contexts');
          await this.assertByteQuota(transaction, candidate.data);
          await this.database.sessionContexts.put(candidate.data);
          return structuredClone(candidate.data);
        },
      );
      return result;
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async saveDraftLocally(
    input: {
      scope: EvaluationStorageScope;
      evaluationId: string | null;
      expectedVersion: number;
      draft: EvaluationDraftPayload;
    },
    options: OperationTime = {},
  ): Promise<StoredEvaluationDraft> {
    const scope = this.parseScope(input.scope);
    const draft = this.parseDraft(input.draft);
    const now = safeDate(options.now ?? new Date());
    if (
      !(input.evaluationId === null || uuid.safeParse(input.evaluationId).success) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    ) {
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation draft context.');
    }
    const record: StoredEvaluationDraft = {
      scopeKey: scopeKey(scope),
      scope,
      evaluationId: input.evaluationId,
      expectedVersion: input.expectedVersion,
      draft,
      payloadDigest: await digestValue(
        evaluationPayload(scope, input.evaluationId, input.expectedVersion, draft),
      ),
      syncState: 'saved_device',
      updatedAt: now.toISOString(),
      expiresAt: addMilliseconds(now, DRAFT_TTL_MS),
    };
    notify(options, 'saving_local');
    let result: StoredEvaluationDraft;
    try {
      result = await this.database.transaction('rw', ...this.allTables(), async (transaction) => {
        const context = await this.requireContext(transaction, scope);
        this.assertDraftMatchesContext(draft, context);
        const exists = await this.database.drafts.get(record.scopeKey);
        if (!exists && (await this.database.drafts.count()) >= this.quotas.maxDrafts)
          throw quotaError('drafts');
        await this.assertByteQuota(transaction, record);
        await this.database.drafts.put(record);
        return structuredClone(record);
      });
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
    notify(options, 'saved_device');
    return result;
  }

  async loadDraft(scopeInput: EvaluationStorageScope): Promise<StoredEvaluationDraft | null> {
    const scope = this.parseScope(scopeInput);
    let corruption = false;
    try {
      const result = await this.database.transaction(
        'rw',
        ...this.allTables(),
        async (transaction) => {
          const raw = await this.database.drafts.get(scopeKey(scope));
          if (!raw) return null;
          try {
            const record = await this.validateDraftRecord(raw, scope);
            const context = await this.requireContext(transaction, scope);
            this.assertDraftMatchesContext(record.draft, context);
            return structuredClone(record);
          } catch (error) {
            if (
              error instanceof EvaluationOfflineError &&
              (error.code === 'corrupt_record' ||
                error.code === 'context_not_found' ||
                error.code === 'invalid_input')
            ) {
              await this.moveToQuarantine(
                transaction,
                'drafts',
                raw,
                error.code === 'corrupt_record' ? 'digest_mismatch' : 'invalid_record',
                'Stored draft or rubric context failed validation.',
                new Date(),
              );
              corruption = true;
              return null;
            }
            throw error;
          }
        },
      );
      if (corruption)
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Stored draft was retained in quarantine for recovery.',
        );
      return result;
    } catch (error) {
      throw mapStorageError(error, 'read');
    }
  }

  async enqueueEvaluationMutation(
    input: EvaluationMutationInput,
    options: OperationTime = {},
  ): Promise<StoredEvaluationMutation> {
    const scope = this.parseScope(input.scope);
    const draft = this.parseDraft(input.draft);
    const now = safeDate(options.now ?? new Date());
    const clientMutationId = input.clientMutationId ?? crypto.randomUUID();
    if (
      !uuid.safeParse(clientMutationId).success ||
      !uuid.safeParse(input.evaluationId).success ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    ) {
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation mutation context.');
    }
    const payloadDigest = await digestValue(
      evaluationPayload(scope, input.evaluationId, input.expectedVersion, draft),
    );
    const timestamp = now.toISOString();
    const record: StoredEvaluationMutation = {
      storageKey: `${scopeKey(scope)}|${clientMutationId}`,
      clientMutationId,
      scopeKey: scopeKey(scope),
      queueKey: evaluationQueueKey(scope, input.evaluationId),
      scope,
      evaluationId: input.evaluationId,
      expectedVersion: input.expectedVersion,
      draft,
      payloadDigest,
      status: 'pending',
      syncState: 'saved_device',
      createdAt: timestamp,
      updatedAt: timestamp,
      nextAttemptAt: timestamp,
      attemptCount: 0,
    };
    let corruption = false;
    try {
      const result = await this.database.transaction(
        'rw',
        ...this.allTables(),
        async (transaction) => {
          const context = await this.requireContext(transaction, scope);
          this.assertDraftMatchesContext(draft, context);
          const existingRaw = await this.database.mutations
            .where('clientMutationId')
            .equals(clientMutationId)
            .first();
          if (existingRaw) {
            try {
              const existing = await this.validateMutationRecord(existingRaw);
              if (
                existing.payloadDigest === payloadDigest &&
                existing.storageKey === record.storageKey
              )
                return structuredClone(existing);
              throw new EvaluationOfflineError(
                'mutation_id_conflict',
                'The client mutation ID is already bound to different content.',
              );
            } catch (error) {
              if (error instanceof EvaluationOfflineError && error.code === 'corrupt_record') {
                await this.moveToQuarantine(
                  transaction,
                  'mutations',
                  existingRaw,
                  'digest_mismatch',
                  'Duplicate replay found corrupt stored work.',
                  now,
                );
                corruption = true;
                return null;
              }
              throw error;
            }
          }
          const allMutations = await this.database.mutations.toArray();
          if (allMutations.length >= this.quotas.maxMutations) throw quotaError('mutations');
          const unacknowledged = allMutations.filter(
            (item) => item.status !== 'acknowledged',
          ).length;
          const acknowledged = allMutations.length - unacknowledged;
          if (unacknowledged >= this.quotas.maxUnacknowledgedMutations)
            throw quotaError('unacknowledged_mutations');
          if (acknowledged > this.quotas.maxAcknowledgedMutations)
            throw quotaError('acknowledged_mutations');
          await this.assertByteQuota(transaction, record);
          await this.database.mutations.add(record);
          return structuredClone(record);
        },
      );
      if (corruption || !result)
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Corrupt duplicate work was retained in quarantine.',
        );
      return result;
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async nextPendingMutation(
    scopeInput: EvaluationStorageScope,
    options: ClaimOptions = {},
  ): Promise<StoredEvaluationMutation | null> {
    const scope = this.parseScope(scopeInput);
    const now = safeDate(options.now ?? new Date());
    const leaseDuration = Math.max(
      1_000,
      Math.min(5 * 60_000, options.leaseDurationMs ?? LEASE_MS),
    );
    let corruptCount = 0;
    try {
      const result = await this.database.transaction(
        'rw',
        ...this.allTables(),
        async (transaction) => {
          const context = await this.requireContext(transaction, scope);
          const rawRecords = await this.database.mutations
            .where('scopeKey')
            .equals(scopeKey(scope))
            .toArray();
          const records: StoredEvaluationMutation[] = [];
          for (const raw of rawRecords) {
            try {
              const record = await this.validateMutationRecord(raw);
              if (record.status !== 'acknowledged')
                this.assertDraftMatchesContext(record.draft, context);
              records.push(record);
            } catch {
              await this.moveToQuarantine(
                transaction,
                'mutations',
                raw,
                'digest_mismatch',
                'Claim scan found malformed or digest-mismatched work.',
                now,
              );
              corruptCount += 1;
            }
          }
          const ordered = records
            .filter((record) => record.status !== 'acknowledged')
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.clientMutationId.localeCompare(right.clientMutationId),
            );
          const seenQueues = new Set<string>();
          const heads: StoredEvaluationMutation[] = [];
          for (const record of ordered) {
            if (!seenQueues.has(record.queueKey)) {
              seenQueues.add(record.queueKey);
              heads.push(record);
            }
          }
          const candidate = heads
            .filter(
              (record) =>
                (record.status === 'pending' && record.nextAttemptAt <= now.toISOString()) ||
                (record.status === 'leased' &&
                  Boolean(record.leaseUntil) &&
                  record.leaseUntil! <= now.toISOString()),
            )
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.clientMutationId.localeCompare(right.clientMutationId),
            )[0];
          if (!candidate) return null;
          const claimed: StoredEvaluationMutation = {
            ...candidate,
            status: 'leased',
            syncState: 'syncing',
            claimToken: crypto.randomUUID(),
            leaseUntil: addMilliseconds(now, leaseDuration),
            updatedAt: now.toISOString(),
          };
          await this.database.mutations.put(claimed);
          return structuredClone(claimed);
        },
      );
      if (!result && corruptCount > 0)
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Malformed work was retained in quarantine.',
        );
      return result;
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  private validateTransitionInput(input: {
    scope: EvaluationStorageScope;
    evaluationId: string;
    clientMutationId: string;
    claimToken: string;
    now?: Date;
  }) {
    const scope = this.parseScope(input.scope);
    if (
      !uuid.safeParse(input.evaluationId).success ||
      !uuid.safeParse(input.clientMutationId).success ||
      !uuid.safeParse(input.claimToken).success
    ) {
      throw new EvaluationOfflineError('invalid_input', 'Invalid fenced mutation transition.');
    }
    return { ...input, scope, now: safeDate(input.now ?? new Date()) };
  }

  private assertExactLease(
    mutation: StoredEvaluationMutation,
    input: ReturnType<EvaluationOfflineRepository['validateTransitionInput']>,
  ): void {
    if (mutation.status === 'acknowledged')
      throw new EvaluationOfflineError('invalid_transition', 'Acknowledged work is terminal.');
    if (mutation.status !== 'leased' || mutation.claimToken !== input.claimToken) {
      throw new EvaluationOfflineError(
        'lease_mismatch',
        'The mutation lease fencing token does not match.',
      );
    }
    if (!mutation.leaseUntil || mutation.leaseUntil <= input.now.toISOString()) {
      throw new EvaluationOfflineError(
        'lease_expired',
        'The mutation lease expired before this transition.',
      );
    }
    if (
      mutation.scopeKey !== scopeKey(input.scope) ||
      mutation.evaluationId !== input.evaluationId ||
      mutation.clientMutationId !== input.clientMutationId
    ) {
      throw new EvaluationOfflineError(
        'lease_mismatch',
        'The mutation lease does not match the exact scope and target.',
      );
    }
  }

  async recordMutationFailure(input: {
    scope: EvaluationStorageScope;
    evaluationId: string;
    clientMutationId: string;
    claimToken: string;
    category: EvaluationMutationFailureCategory;
    message: string;
    now?: Date;
  }): Promise<StoredEvaluationMutation> {
    return this.updateFailure(
      input,
      ['conflict', 'forbidden', 'invalid_rubric', 'corrupt_record'].includes(input.category),
    );
  }

  async markNeedsAttention(input: {
    scope: EvaluationStorageScope;
    evaluationId: string;
    clientMutationId: string;
    claimToken: string;
    category: EvaluationMutationFailureCategory;
    message: string;
    now?: Date;
  }): Promise<StoredEvaluationMutation> {
    return this.updateFailure(input, true);
  }

  private async updateFailure(
    rawInput: {
      scope: EvaluationStorageScope;
      evaluationId: string;
      clientMutationId: string;
      claimToken: string;
      category: EvaluationMutationFailureCategory;
      message: string;
      now?: Date;
    },
    forceAttention: boolean,
  ): Promise<StoredEvaluationMutation> {
    const input = this.validateTransitionInput(rawInput);
    if (!rawInput.message || rawInput.message.length > 500)
      throw new EvaluationOfflineError('invalid_input', 'Invalid bounded failure details.');
    try {
      return await this.database.transaction('rw', ...this.allTables(), async (transaction) => {
        const raw = await this.database.mutations.get(
          `${scopeKey(input.scope)}|${input.clientMutationId}`,
        );
        if (!raw)
          throw new EvaluationOfflineError('mutation_not_found', 'Evaluation mutation not found.');
        const mutation = await this.validateMutationRecord(raw);
        this.assertExactLease(mutation, input);
        const context = await this.requireContext(transaction, input.scope);
        this.assertDraftMatchesContext(mutation.draft, context);
        const attemptCount = mutation.attemptCount + 1;
        const needsAttention = forceAttention || attemptCount >= MAX_RETRY_ATTEMPTS;
        const updated: StoredEvaluationMutation = {
          ...mutation,
          status: needsAttention ? 'needs_attention' : 'pending',
          syncState: needsAttention ? 'needs_attention' : 'saved_device',
          attemptCount,
          nextAttemptAt: needsAttention
            ? input.now.toISOString()
            : addMilliseconds(input.now, 2 ** attemptCount * 1_000),
          updatedAt: input.now.toISOString(),
          errorCategory:
            attemptCount >= MAX_RETRY_ATTEMPTS && !forceAttention
              ? 'retry_exhausted'
              : rawInput.category,
          lastError: safeDiagnostic(rawInput.message),
          claimToken: undefined,
          leaseUntil: undefined,
        };
        await this.database.mutations.put(updated);
        return structuredClone(updated);
      });
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async resolveNeedsAttention(input: {
    scope: EvaluationStorageScope;
    evaluationId: string;
    clientMutationId: string;
    action: 'retry';
    now?: Date;
  }): Promise<StoredEvaluationMutation> {
    const scope = this.parseScope(input.scope);
    const now = safeDate(input.now ?? new Date());
    if (
      !uuid.safeParse(input.evaluationId).success ||
      !uuid.safeParse(input.clientMutationId).success ||
      input.action !== 'retry'
    )
      throw new EvaluationOfflineError('invalid_input', 'Invalid attention resolution.');
    try {
      return await this.database.transaction('rw', ...this.allTables(), async (transaction) => {
        const raw = await this.database.mutations.get(
          `${scopeKey(scope)}|${input.clientMutationId}`,
        );
        if (!raw)
          throw new EvaluationOfflineError('mutation_not_found', 'Evaluation mutation not found.');
        const mutation = await this.validateMutationRecord(raw);
        if (mutation.status !== 'needs_attention' || mutation.evaluationId !== input.evaluationId)
          throw new EvaluationOfflineError(
            'invalid_transition',
            'Only exact attention work can be explicitly retried.',
          );
        const context = await this.requireContext(transaction, scope);
        this.assertDraftMatchesContext(mutation.draft, context);
        const updated: StoredEvaluationMutation = {
          ...mutation,
          status: 'pending',
          syncState: 'saved_device',
          nextAttemptAt: now.toISOString(),
          updatedAt: now.toISOString(),
          errorCategory: undefined,
          lastError: undefined,
        };
        await this.database.mutations.put(updated);
        return structuredClone(updated);
      });
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async acknowledgeMutation(rawInput: {
    scope: EvaluationStorageScope;
    evaluationId: string;
    clientMutationId: string;
    claimToken: string;
    expectedVersion: number;
    payloadDigest: string;
    serverVersion: number;
    acknowledgedAt: string;
    now?: Date;
  }): Promise<StoredEvaluationReceipt & { syncState: 'synced' }> {
    const transition = this.validateTransitionInput(rawInput);
    const acknowledgedAt = new Date(rawInput.acknowledgedAt);
    if (
      !Number.isSafeInteger(rawInput.expectedVersion) ||
      rawInput.expectedVersion < 0 ||
      !/^[0-9a-f]{64}$/.test(rawInput.payloadDigest) ||
      !Number.isSafeInteger(rawInput.serverVersion) ||
      rawInput.serverVersion < 1 ||
      Number.isNaN(acknowledgedAt.getTime())
    ) {
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation receipt.');
    }
    try {
      return await this.database.transaction('rw', ...this.allTables(), async (transaction) => {
        const storageKey = `${scopeKey(transition.scope)}|${rawInput.clientMutationId}`;
        const existingRaw = await this.database.receipts.get(storageKey);
        if (existingRaw) {
          const existing = await this.validateReceiptRecord(existingRaw);
          const exact =
            existing.scopeKey === scopeKey(transition.scope) &&
            existing.evaluationId === rawInput.evaluationId &&
            existing.clientMutationId === rawInput.clientMutationId &&
            existing.claimToken === rawInput.claimToken &&
            existing.expectedVersion === rawInput.expectedVersion &&
            existing.payloadDigest === rawInput.payloadDigest &&
            existing.serverVersion === rawInput.serverVersion &&
            existing.acknowledgedAt === acknowledgedAt.toISOString();
          if (!exact)
            throw new EvaluationOfflineError(
              'receipt_mismatch',
              'Only an exact acknowledgment replay is idempotent.',
            );
          return { ...structuredClone(existing), syncState: 'synced' as const };
        }
        const raw = await this.database.mutations.get(storageKey);
        if (!raw)
          throw new EvaluationOfflineError('mutation_not_found', 'Evaluation mutation not found.');
        const mutation = await this.validateMutationRecord(raw);
        this.assertExactLease(mutation, transition);
        if (
          mutation.expectedVersion !== rawInput.expectedVersion ||
          mutation.payloadDigest !== rawInput.payloadDigest ||
          rawInput.serverVersion !== mutation.expectedVersion + 1
        ) {
          throw new EvaluationOfflineError(
            'receipt_mismatch',
            'Server receipt does not match the exact leased payload.',
          );
        }
        const context = await this.requireContext(transaction, transition.scope);
        this.assertDraftMatchesContext(mutation.draft, context);
        const acknowledgedCount = await this.database.mutations
          .filter((candidate) => candidate.status === 'acknowledged')
          .count();
        if (acknowledgedCount >= this.quotas.maxAcknowledgedMutations) {
          throw quotaError('acknowledged_mutations');
        }
        if ((await this.database.receipts.count()) >= this.quotas.maxReceipts)
          throw quotaError('receipts');
        const receiptWithoutDigest: Omit<StoredEvaluationReceipt, 'receiptDigest'> = {
          storageKey,
          clientMutationId: mutation.clientMutationId,
          scopeKey: mutation.scopeKey,
          scope: mutation.scope,
          evaluationId: mutation.evaluationId,
          expectedVersion: mutation.expectedVersion,
          payloadDigest: mutation.payloadDigest,
          claimToken: rawInput.claimToken,
          serverVersion: rawInput.serverVersion,
          acknowledgedAt: acknowledgedAt.toISOString(),
          expiresAt: addMilliseconds(acknowledgedAt, RECEIPT_TTL_MS),
        };
        const receipt: StoredEvaluationReceipt = {
          ...receiptWithoutDigest,
          receiptDigest: await Dexie.waitFor(digestValue(receiptPayload(receiptWithoutDigest))),
        };
        await this.assertByteQuota(transaction, receipt);
        await this.database.receipts.add(receipt);
        const acknowledged: StoredEvaluationMutation = {
          ...mutation,
          status: 'acknowledged',
          syncState: 'synced',
          acknowledgedAt: acknowledgedAt.toISOString(),
          updatedAt: transition.now.toISOString(),
          claimToken: undefined,
          leaseUntil: undefined,
        };
        await this.database.mutations.put(acknowledged);
        const rawDraft = await this.database.drafts.get(mutation.scopeKey);
        if (rawDraft) {
          const storedDraft = await this.validateDraftRecord(rawDraft, mutation.scope);
          if (storedDraft.payloadDigest === mutation.payloadDigest) {
            const syncedDraft = {
              ...storedDraft,
              syncState: 'synced' as const,
              expectedVersion: rawInput.serverVersion,
              payloadDigest: await Dexie.waitFor(
                digestValue(
                  evaluationPayload(
                    storedDraft.scope,
                    storedDraft.evaluationId,
                    rawInput.serverVersion,
                    storedDraft.draft,
                  ),
                ),
              ),
              updatedAt: transition.now.toISOString(),
              expiresAt: addMilliseconds(transition.now, DRAFT_TTL_MS),
            };
            await this.database.drafts.put(syncedDraft);
          }
        }
        return { ...structuredClone(receipt), syncState: 'synced' as const };
      });
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async listMutations(scopeInput: EvaluationStorageScope): Promise<StoredEvaluationMutation[]> {
    const scope = this.parseScope(scopeInput);
    let corrupt = false;
    try {
      const records = await this.database.transaction(
        'rw',
        ...this.allTables(),
        async (transaction) => {
          const rawRecords = await this.database.mutations
            .where('scopeKey')
            .equals(scopeKey(scope))
            .sortBy('createdAt');
          const rawContext = await this.database.sessionContexts.get(scopeKey(scope));
          let context: StoredSessionContext | null = null;
          if (rawContext) {
            try {
              context = await this.validateContext(rawContext, scope);
            } catch {
              await this.moveToQuarantine(
                transaction,
                'sessionContexts',
                rawContext,
                'invalid_record',
                'Mutation read found invalid rubric context.',
                new Date(),
              );
              corrupt = true;
            }
          }
          const valid: StoredEvaluationMutation[] = [];
          for (const raw of rawRecords) {
            try {
              const record = await this.validateMutationRecord(raw);
              if (context) this.assertDraftMatchesContext(record.draft, context);
              else if (record.status !== 'needs_attention') {
                throw new EvaluationOfflineError(
                  'corrupt_record',
                  'Syncable work has no exact rubric context.',
                );
              }
              valid.push(record);
            } catch {
              await this.moveToQuarantine(
                transaction,
                'mutations',
                raw,
                'invalid_record',
                'Mutation read failed strict validation.',
                new Date(),
              );
              corrupt = true;
            }
          }
          return valid.map((record) => structuredClone(record));
        },
      );
      if (corrupt)
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Malformed mutations were retained in quarantine.',
        );
      return records;
    } catch (error) {
      throw mapStorageError(error, 'read');
    }
  }

  async listQuarantines(
    scopeInput: EvaluationStorageScope,
  ): Promise<Omit<StoredEvaluationQuarantine, 'originalRecord'>[]> {
    const scope = this.parseScope(scopeInput);
    try {
      const rawRecords = await this.database.quarantines
        .where('scopeKey')
        .equals(scopeKey(scope))
        .sortBy('createdAt');
      return rawRecords.map((raw) => {
        const parsed = storedQuarantineSchema.safeParse(raw);
        if (!parsed.success)
          throw new EvaluationOfflineError(
            'corrupt_record',
            'Stored quarantine metadata is malformed.',
          );
        const { originalRecord: _originalRecord, ...safe } = parsed.data;
        return structuredClone(safe);
      });
    } catch (error) {
      throw mapStorageError(error, 'read');
    }
  }

  async getReceipt(
    scopeInput: EvaluationStorageScope,
    clientMutationId: string,
  ): Promise<StoredEvaluationReceipt | null> {
    const scope = this.parseScope(scopeInput);
    if (!uuid.safeParse(clientMutationId).success)
      throw new EvaluationOfflineError('invalid_input', 'Invalid receipt mutation ID.');
    let corrupt = false;
    try {
      const result = await this.database.transaction(
        'rw',
        ...this.allTables(),
        async (transaction) => {
          const raw = await this.database.receipts.get(`${scopeKey(scope)}|${clientMutationId}`);
          if (!raw) return null;
          try {
            return structuredClone(await this.validateReceiptRecord(raw));
          } catch {
            await this.moveToQuarantine(
              transaction,
              'receipts',
              raw,
              'digest_mismatch',
              'Receipt read failed strict integrity validation.',
              new Date(),
            );
            corrupt = true;
            return null;
          }
        },
      );
      if (corrupt) {
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Malformed receipt was retained in quarantine.',
        );
      }
      return result;
    } catch (error) {
      throw mapStorageError(error, 'read');
    }
  }

  async getSyncState(scopeInput: EvaluationStorageScope): Promise<EvaluationSyncState | null> {
    const scope = this.parseScope(scopeInput);
    try {
      const draft = await this.loadDraft(scope);
      if (draft) return draft.syncState;
      const receipts = await this.database.receipts
        .where('scopeKey')
        .equals(scopeKey(scope))
        .toArray();
      for (const receipt of receipts) {
        await this.getReceipt(scope, receipt.clientMutationId);
      }
      if (receipts.length) return 'synced';
      const mutations = await this.listMutations(scope);
      return mutations[0]?.syncState ?? null;
    } catch (error) {
      throw mapStorageError(error, 'read');
    }
  }

  async clearAcknowledged(scopeInput: EvaluationStorageScope): Promise<number> {
    const scope = this.parseScope(scopeInput);
    try {
      const result = await this.database.transaction(
        'rw',
        ...this.allTables(),
        async (transaction) => {
          const records = await this.database.mutations
            .where('scopeKey')
            .equals(scopeKey(scope))
            .toArray();
          const acknowledged: string[] = [];
          let corrupt = false;
          for (const raw of records) {
            try {
              const record = await this.validateMutationRecord(raw);
              if (record.status === 'acknowledged') {
                const rawReceipt = await this.database.receipts.get(record.storageKey);
                const receipt = rawReceipt ? await this.validateReceiptRecord(rawReceipt) : null;
                if (
                  !receipt ||
                  receipt.payloadDigest !== record.payloadDigest ||
                  receipt.expectedVersion !== record.expectedVersion
                ) {
                  throw new EvaluationOfflineError(
                    'corrupt_record',
                    'Acknowledged mutation has no exact durable receipt.',
                  );
                }
                acknowledged.push(record.storageKey);
              }
            } catch {
              await this.moveToQuarantine(
                transaction,
                'mutations',
                raw,
                'digest_mismatch',
                'Compaction retained an invalid acknowledged mutation for review.',
                new Date(),
              );
              corrupt = true;
            }
          }
          if (!corrupt) await this.database.mutations.bulkDelete(acknowledged);
          return { count: corrupt ? 0 : acknowledged.length, corrupt };
        },
      );
      if (result.corrupt)
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Invalid acknowledged work was retained in quarantine.',
        );
      return result.count;
    } catch (error) {
      throw mapStorageError(error, 'cleanup');
    }
  }

  async teardownScope(
    scopeInput: EvaluationStorageScope,
  ): Promise<{ cleared: boolean; retainedUnacknowledged: number }> {
    const scope = this.parseScope(scopeInput);
    const key = scopeKey(scope);
    try {
      return await this.database.transaction('rw', ...this.allTables(), async (transaction) => {
        const rawMutations = await this.database.mutations.where('scopeKey').equals(key).toArray();
        const rawReceipts = await this.database.receipts.where('scopeKey').equals(key).toArray();
        const rawDraft = await this.database.drafts.get(key);
        const rawContext = await this.database.sessionContexts.get(key);
        const existingQuarantines = await this.database.quarantines
          .where('scopeKey')
          .equals(key)
          .toArray();
        for (const record of existingQuarantines) {
          if (!storedQuarantineSchema.safeParse(record).success) {
            throw new EvaluationOfflineError('corrupt_record', 'Quarantine metadata is malformed.');
          }
        }
        const receipts = new Map<string, StoredEvaluationReceipt>();
        let newlyQuarantined = 0;
        for (const raw of rawReceipts) {
          try {
            const receipt = await this.validateReceiptRecord(raw);
            receipts.set(receipt.storageKey, receipt);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'receipts',
              raw,
              'digest_mismatch',
              'Teardown retained an invalid receipt for review.',
              new Date(),
            );
            newlyQuarantined += 1;
          }
        }
        const mutations: StoredEvaluationMutation[] = [];
        for (const raw of rawMutations) {
          try {
            const mutation = await this.validateMutationRecord(raw);
            if (mutation.status === 'acknowledged') {
              const receipt = receipts.get(mutation.storageKey);
              if (
                !receipt ||
                receipt.payloadDigest !== mutation.payloadDigest ||
                receipt.expectedVersion !== mutation.expectedVersion
              ) {
                throw new EvaluationOfflineError(
                  'corrupt_record',
                  'Acknowledged mutation has no exact durable receipt.',
                );
              }
            }
            mutations.push(mutation);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'mutations',
              raw,
              'digest_mismatch',
              'Teardown retained an invalid mutation for review.',
              new Date(),
            );
            newlyQuarantined += 1;
          }
        }
        if (rawDraft) {
          try {
            await this.validateDraftRecord(rawDraft, scope);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'drafts',
              rawDraft,
              'digest_mismatch',
              'Teardown retained an invalid draft for review.',
              new Date(),
            );
            newlyQuarantined += 1;
          }
        }
        if (rawContext) {
          try {
            await this.validateContext(rawContext, scope);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'sessionContexts',
              rawContext,
              'invalid_record',
              'Teardown retained an invalid rubric context for review.',
              new Date(),
            );
            newlyQuarantined += 1;
          }
        }
        const retained =
          mutations.filter((record) => record.status !== 'acknowledged').length +
          existingQuarantines.length +
          newlyQuarantined;
        if (retained > 0) return { cleared: false, retainedUnacknowledged: retained };
        await this.database.mutations.bulkDelete(mutations.map((record) => record.storageKey));
        await this.database.drafts.delete(key);
        await this.database.sessionContexts.delete(key);
        await this.database.receipts.where('scopeKey').equals(key).delete();
        return { cleared: true, retainedUnacknowledged: 0 };
      });
    } catch (error) {
      throw mapStorageError(error, 'cleanup');
    }
  }

  async cleanupExpired(
    scopeInput: EvaluationStorageScope,
    now = new Date(),
  ): Promise<{
    acknowledgedMutations: number;
    receipts: number;
    drafts: number;
    sessionContexts: number;
  }> {
    const scope = this.parseScope(scopeInput);
    const timestamp = safeDate(now).toISOString();
    const key = scopeKey(scope);
    try {
      return await this.database.transaction('rw', ...this.allTables(), async (transaction) => {
        const rawMutations = await this.database.mutations.where('scopeKey').equals(key).toArray();
        const rawReceipts = await this.database.receipts.where('scopeKey').equals(key).toArray();
        const rawDraft = await this.database.drafts.get(key);
        const rawContext = await this.database.sessionContexts.get(key);
        let corrupt = false;
        const receipts: StoredEvaluationReceipt[] = [];
        for (const raw of rawReceipts) {
          try {
            receipts.push(await this.validateReceiptRecord(raw));
          } catch {
            await this.moveToQuarantine(
              transaction,
              'receipts',
              raw,
              'digest_mismatch',
              'TTL cleanup retained an invalid receipt for review.',
              now,
            );
            corrupt = true;
          }
        }
        const mutations: StoredEvaluationMutation[] = [];
        for (const raw of rawMutations) {
          try {
            mutations.push(await this.validateMutationRecord(raw));
          } catch {
            await this.moveToQuarantine(
              transaction,
              'mutations',
              raw,
              'digest_mismatch',
              'TTL cleanup retained an invalid mutation for review.',
              now,
            );
            corrupt = true;
          }
        }
        if (rawDraft) {
          try {
            await this.validateDraftRecord(rawDraft, scope);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'drafts',
              rawDraft,
              'digest_mismatch',
              'TTL cleanup retained an invalid draft for review.',
              now,
            );
            corrupt = true;
          }
        }
        if (rawContext) {
          try {
            await this.validateContext(rawContext, scope);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'sessionContexts',
              rawContext,
              'invalid_record',
              'TTL cleanup retained an invalid rubric context for review.',
              now,
            );
            corrupt = true;
          }
        }
        if (corrupt)
          return { acknowledgedMutations: 0, receipts: 0, drafts: 0, sessionContexts: 0 };
        const quarantines = await this.database.quarantines.where('scopeKey').equals(key).count();
        const hasUnacknowledged =
          mutations.some((record) => record.status !== 'acknowledged') || quarantines > 0;
        const expiredReceipts = receipts.filter((receipt) => receipt.expiresAt <= timestamp);
        const expiredReceiptKeys = new Set(expiredReceipts.map((receipt) => receipt.storageKey));
        const acknowledgedKeys = mutations
          .filter((mutation) => {
            if (mutation.status !== 'acknowledged' || !expiredReceiptKeys.has(mutation.storageKey))
              return false;
            const receipt = receipts.find(
              (candidate) => candidate.storageKey === mutation.storageKey,
            );
            return (
              receipt?.payloadDigest === mutation.payloadDigest &&
              receipt.expectedVersion === mutation.expectedVersion
            );
          })
          .map((mutation) => mutation.storageKey);
        await this.database.mutations.bulkDelete(acknowledgedKeys);
        await this.database.receipts.bulkDelete([...expiredReceiptKeys]);
        let drafts = 0;
        let sessionContexts = 0;
        if (!hasUnacknowledged) {
          if (rawDraft?.expiresAt && rawDraft.expiresAt <= timestamp) {
            await this.database.drafts.delete(key);
            drafts = 1;
          }
          if (rawContext?.expiresAt && rawContext.expiresAt <= timestamp) {
            await this.database.sessionContexts.delete(key);
            sessionContexts = 1;
          }
        }
        return {
          acknowledgedMutations: acknowledgedKeys.length,
          receipts: expiredReceipts.length,
          drafts,
          sessionContexts,
        };
      });
    } catch (error) {
      throw mapStorageError(error, 'cleanup');
    }
  }

  async migrateLegacySharedDatabase(input: {
    legacyDatabaseName: string;
  }): Promise<{ imported: number; quarantined: number }> {
    if (
      !/^[a-zA-Z0-9._-]{1,120}$/.test(input.legacyDatabaseName) ||
      input.legacyDatabaseName === this.databaseName
    )
      throw new EvaluationOfflineError('invalid_input', 'Invalid legacy shared database name.');
    const exists = await Dexie.exists(input.legacyDatabaseName);
    if (!exists) return { imported: 0, quarantined: 0 };
    const legacy = new Dexie(input.legacyDatabaseName, {
      indexedDB: this.indexedDbFactory,
      IDBKeyRange: this.keyRangeFactory,
    });
    const matching = new Map<QuarantineSource, unknown[]>();
    try {
      await legacy.open();
      for (const sourceTable of ['sessionContexts', 'drafts', 'mutations', 'receipts'] as const) {
        if (!legacy.tables.some((table) => table.name === sourceTable)) continue;
        matching.set(
          sourceTable,
          (await legacy.table(sourceTable).toArray()).filter((raw) => {
            const value =
              raw && typeof raw === 'object' ? (raw as Record<string, unknown>).scope : undefined;
            const parsed = evaluationScopeSchema.safeParse(value);
            return parsed.success && parsed.data.userId === this.authenticatedUserId;
          }),
        );
      }
    } catch (error) {
      throw mapStorageError(error, 'read');
    } finally {
      legacy.close();
    }
    let imported = 0;
    let quarantined = 0;
    try {
      await this.database.transaction('rw', ...this.allTables(), async (transaction) => {
        for (const raw of matching.get('sessionContexts') ?? []) {
          const item = raw as Record<string, unknown>;
          const parsedScope = evaluationScopeSchema.safeParse(item.scope);
          const candidate = parsedScope.success
            ? storedSessionContextSchema.safeParse({
                scopeKey: scopeKey(parsedScope.data),
                scope: parsedScope.data,
                tryoutNumber: item.tryoutNumber ?? null,
                categories: item.categories,
                expiresAt: item.expiresAt,
              })
            : null;
          if (!candidate?.success) {
            await this.addToQuarantine(
              transaction,
              'sessionContexts',
              raw,
              'invalid_record',
              'Shared legacy context failed strict import validation.',
              new Date(),
            );
            quarantined += 1;
          } else if (!(await this.database.sessionContexts.get(candidate.data.scopeKey))) {
            if ((await this.database.sessionContexts.count()) >= this.quotas.maxContexts) {
              throw quotaError('contexts');
            }
            await this.assertByteQuota(transaction, candidate.data);
            await this.database.sessionContexts.add(candidate.data);
            imported += 1;
          }
        }

        for (const raw of matching.get('drafts') ?? []) {
          const item = raw as Record<string, unknown>;
          const parsedScope = evaluationScopeSchema.safeParse(item.scope);
          const parsedDraft = evaluationDraftSchema.safeParse(item.draft);
          if (
            !parsedScope.success ||
            !parsedDraft.success ||
            !(item.evaluationId === null || uuid.safeParse(item.evaluationId).success) ||
            !Number.isSafeInteger(item.expectedVersion)
          ) {
            await this.addToQuarantine(
              transaction,
              'drafts',
              raw,
              'invalid_record',
              'Shared legacy draft failed strict import validation.',
              new Date(),
            );
            quarantined += 1;
            continue;
          }
          const fullKey = scopeKey(parsedScope.data);
          if (await this.database.drafts.get(fullKey)) continue;
          const digest = await Dexie.waitFor(
            digestValue(
              evaluationPayload(
                parsedScope.data,
                item.evaluationId as string | null,
                item.expectedVersion as number,
                parsedDraft.data,
              ),
            ),
          );
          const candidate = storedDraftSchema.safeParse({
            scopeKey: fullKey,
            scope: parsedScope.data,
            evaluationId: item.evaluationId,
            expectedVersion: item.expectedVersion,
            draft: parsedDraft.data,
            payloadDigest: digest,
            syncState: item.syncState === 'synced' ? 'synced' : 'saved_device',
            updatedAt: item.updatedAt,
            expiresAt: item.expiresAt,
          });
          if (!candidate.success) {
            await this.addToQuarantine(
              transaction,
              'drafts',
              raw,
              'invalid_record',
              'Shared legacy draft dates or state are invalid.',
              new Date(),
            );
            quarantined += 1;
          } else {
            if ((await this.database.drafts.count()) >= this.quotas.maxDrafts) {
              throw quotaError('drafts');
            }
            await this.assertByteQuota(transaction, candidate.data);
            await this.database.drafts.add(candidate.data);
            imported += 1;
          }
        }

        for (const raw of matching.get('mutations') ?? []) {
          const item = raw as Record<string, unknown>;
          const parsedScope = evaluationScopeSchema.safeParse(item.scope);
          const parsedDraft = evaluationDraftSchema.safeParse(item.draft);
          if (
            !parsedScope.success ||
            !parsedDraft.success ||
            !uuid.safeParse(item.clientMutationId).success ||
            !uuid.safeParse(item.evaluationId).success ||
            !Number.isSafeInteger(item.expectedVersion)
          ) {
            await this.addToQuarantine(
              transaction,
              'mutations',
              raw,
              'invalid_record',
              'Shared legacy mutation failed strict import validation.',
              new Date(),
            );
            quarantined += 1;
            continue;
          }
          const fullKey = scopeKey(parsedScope.data);
          const storageKey = `${fullKey}|${item.clientMutationId as string}`;
          if (await this.database.mutations.get(storageKey)) continue;
          const now = new Date().toISOString();
          const payloadDigest = await Dexie.waitFor(
            digestValue(
              evaluationPayload(
                parsedScope.data,
                item.evaluationId as string,
                item.expectedVersion as number,
                parsedDraft.data,
              ),
            ),
          );
          const candidate: StoredEvaluationMutation = {
            storageKey,
            clientMutationId: item.clientMutationId as string,
            scopeKey: fullKey,
            queueKey: evaluationQueueKey(parsedScope.data, item.evaluationId as string),
            scope: parsedScope.data,
            evaluationId: item.evaluationId as string,
            expectedVersion: item.expectedVersion as number,
            draft: parsedDraft.data,
            payloadDigest,
            status: 'needs_attention',
            syncState: 'needs_attention',
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
            updatedAt: now,
            nextAttemptAt: now,
            attemptCount: typeof item.attemptCount === 'number' ? item.attemptCount : 0,
            errorCategory: 'migration_context_required',
            lastError: 'Imported shared-device work requires explicit rubric review.',
          };
          const parsed = storedMutationSchema.safeParse(candidate);
          if (!parsed.success) {
            await this.addToQuarantine(
              transaction,
              'mutations',
              raw,
              'invalid_record',
              'Shared legacy mutation has invalid dates or state.',
              new Date(),
            );
            quarantined += 1;
          } else {
            const storedMutations = await this.database.mutations.toArray();
            if (storedMutations.length >= this.quotas.maxMutations) {
              throw quotaError('mutations');
            }
            if (
              storedMutations.filter((record) => record.status !== 'acknowledged').length >=
              this.quotas.maxUnacknowledgedMutations
            ) {
              throw quotaError('unacknowledged_mutations');
            }
            await this.assertByteQuota(transaction, parsed.data);
            await this.database.mutations.add(parsed.data);
            imported += 1;
          }
        }

        for (const raw of matching.get('receipts') ?? []) {
          const item = raw as Record<string, unknown>;
          const parsedScope = evaluationScopeSchema.safeParse(item.scope);
          if (
            !parsedScope.success ||
            !uuid.safeParse(item.clientMutationId).success ||
            !uuid.safeParse(item.evaluationId).success ||
            !uuid.safeParse(item.claimToken).success ||
            !Number.isSafeInteger(item.expectedVersion) ||
            !Number.isSafeInteger(item.serverVersion) ||
            typeof item.payloadDigest !== 'string'
          ) {
            await this.addToQuarantine(
              transaction,
              'receipts',
              raw,
              'invalid_record',
              'Shared legacy receipt failed strict import validation.',
              new Date(),
            );
            quarantined += 1;
            continue;
          }
          const fullKey = scopeKey(parsedScope.data);
          const storageKey = `${fullKey}|${item.clientMutationId as string}`;
          if (await this.database.receipts.get(storageKey)) continue;
          const withoutDigest: Omit<StoredEvaluationReceipt, 'receiptDigest'> = {
            storageKey,
            clientMutationId: item.clientMutationId as string,
            scopeKey: fullKey,
            scope: parsedScope.data,
            evaluationId: item.evaluationId as string,
            expectedVersion: item.expectedVersion as number,
            payloadDigest: item.payloadDigest,
            claimToken: item.claimToken as string,
            serverVersion: item.serverVersion as number,
            acknowledgedAt: item.acknowledgedAt as string,
            expiresAt: item.expiresAt as string,
          };
          const candidate = storedReceiptSchema.safeParse({
            ...withoutDigest,
            receiptDigest: await Dexie.waitFor(digestValue(receiptPayload(withoutDigest))),
          });
          if (!candidate.success) {
            await this.addToQuarantine(
              transaction,
              'receipts',
              raw,
              'invalid_record',
              'Shared legacy receipt dates or state are invalid.',
              new Date(),
            );
            quarantined += 1;
          } else {
            if ((await this.database.receipts.count()) >= this.quotas.maxReceipts) {
              throw quotaError('receipts');
            }
            await this.assertByteQuota(transaction, candidate.data);
            await this.database.receipts.add(candidate.data);
            imported += 1;
          }
        }
      });
      return { imported, quarantined };
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async exportSafeDiagnostic(scopeInput: EvaluationStorageScope): Promise<{
    scope: EvaluationStorageScope;
    mutations: {
      clientMutationId: string;
      evaluationId: string;
      expectedVersion: number;
      status: StoredEvaluationMutation['status'];
      attemptCount: number;
      errorCategory?: string;
    }[];
    quarantineCount: number;
  }> {
    const scope = this.parseScope(scopeInput);
    const records = await this.listMutations(scope);
    const quarantines = await this.listQuarantines(scope);
    return {
      scope,
      mutations: records.slice(0, 100).map((record) => ({
        clientMutationId: record.clientMutationId,
        evaluationId: record.evaluationId,
        expectedVersion: record.expectedVersion,
        status: record.status,
        attemptCount: record.attemptCount,
        ...(record.errorCategory ? { errorCategory: record.errorCategory.slice(0, 80) } : {}),
      })),
      quarantineCount: quarantines.length,
    };
  }
}

export function createEvaluationOfflineRepository(
  options: RepositoryOptions,
): EvaluationOfflineRepository {
  const parsedUser = uuid.safeParse(options.authenticatedUserId);
  if (!parsedUser.success)
    throw new EvaluationOfflineError(
      'invalid_input',
      'A valid authenticated user is required for offline storage.',
    );
  const indexedDb = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const keyRange = options.keyRange === undefined ? globalThis.IDBKeyRange : options.keyRange;
  if (!indexedDb || !keyRange)
    throw new EvaluationOfflineError(
      'storage_unavailable',
      'IndexedDB is unavailable; evaluation work has not been saved on this device.',
    );
  const databaseName = evaluationDatabaseName(
    options.databaseName ?? DEFAULT_EVALUATION_OFFLINE_DATABASE,
    parsedUser.data,
  );
  return new EvaluationOfflineRepository(
    new EvaluationOfflineDatabase(databaseName, indexedDb, keyRange, parsedUser.data),
    parsedUser.data,
    indexedDb,
    keyRange,
    options.quotas,
  );
}

export { evaluationDatabaseName } from './database';
