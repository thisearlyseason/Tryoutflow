import Dexie from 'dexie';
import { z } from 'zod';

import {
  DEFAULT_EVALUATION_OFFLINE_DATABASE,
  EvaluationOfflineDatabase,
  digestValue,
  scopeKey,
  type EvaluationDraftPayload,
  type EvaluationStorageScope,
  type StoredEvaluationDraft,
  type StoredEvaluationMutation,
  type StoredEvaluationReceipt,
  type StoredSessionContext,
} from './database';
import type { EvaluationSyncState } from './sync-state';

const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const LEASE_MS = 30_000;
const MAX_UNACKNOWLEDGED_MUTATIONS = 1_000;
const MAX_DRAFT_BYTES = 64 * 1_024;
const MAX_RETRY_ATTEMPTS = 5;

const uuid = z.uuid();
const scopeSchema = z.strictObject({
  userId: uuid,
  evaluatorId: uuid,
  organizationId: uuid,
  tryoutId: uuid,
  sessionId: uuid,
  registrationId: uuid,
  rubricVersionId: uuid,
});
const draftSchema = z.strictObject({
  scores: z
    .array(z.strictObject({ categoryId: uuid, value: z.number().int().min(1).max(10) }))
    .max(100),
  note: z.string().max(4_000).optional(),
  noteTagIds: z.array(uuid).max(50),
  flags: z.array(z.string().min(1).max(80)).max(20),
});
const isoDate = z.iso.datetime({ offset: true });
const storedMutationSchema = z.strictObject({
  storageKey: z.string().min(1),
  clientMutationId: uuid,
  scopeKey: z.string().min(1),
  scope: scopeSchema,
  evaluationId: uuid,
  expectedVersion: z.number().int().min(0),
  draft: draftSchema,
  payloadDigest: z.string().min(1),
  status: z.enum(['pending', 'leased', 'acknowledged', 'needs_attention']),
  syncState: z.enum(['saving_local', 'saved_device', 'syncing', 'synced', 'needs_attention']),
  createdAt: isoDate,
  updatedAt: isoDate,
  nextAttemptAt: isoDate,
  attemptCount: z.number().int().min(0),
  leaseOwner: z.string().min(1).max(200).optional(),
  leaseUntil: isoDate.optional(),
  errorCategory: z.string().min(1).max(80).optional(),
  lastError: z.string().max(500).optional(),
  acknowledgedAt: isoDate.optional(),
});

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

export class EvaluationOfflineError extends Error {
  constructor(
    public readonly code:
      | 'storage_unavailable'
      | 'invalid_input'
      | 'storage_limit'
      | 'storage_write_failed'
      | 'mutation_id_conflict'
      | 'mutation_not_found'
      | 'receipt_mismatch'
      | 'lease_mismatch'
      | 'corrupt_record',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EvaluationOfflineError';
  }
}

type RepositoryOptions = {
  databaseName?: string;
  indexedDB?: IDBFactory | null;
  keyRange?: typeof IDBKeyRange | null;
};

type OperationTime = {
  now?: Date;
  onSyncState?: (state: EvaluationSyncState) => void;
};
type ClaimOptions = OperationTime & { leaseOwner?: string; leaseDurationMs?: number };

function parseScope(value: EvaluationStorageScope): EvaluationStorageScope {
  const parsed = scopeSchema.safeParse(value);
  if (!parsed.success) throw new EvaluationOfflineError('invalid_input', 'Invalid storage scope.');
  return parsed.data;
}

function parseDraft(value: EvaluationDraftPayload): EvaluationDraftPayload {
  const parsed = draftSchema.safeParse(value);
  if (!parsed.success)
    throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation draft.');
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > MAX_DRAFT_BYTES) {
    throw new EvaluationOfflineError('storage_limit', 'The local evaluation draft is too large.');
  }
  return structuredClone(parsed.data);
}

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function mapStorageError(error: unknown): EvaluationOfflineError {
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
  const code = hasName(error, 'QuotaExceededError') ? 'storage_limit' : 'storage_write_failed';
  return new EvaluationOfflineError(code, 'Evaluation device storage did not commit.', {
    cause: error,
  });
}

export class EvaluationOfflineRepository {
  constructor(private readonly database: EvaluationOfflineDatabase) {}

  close(): void {
    this.database.close();
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
    const now = options.now ?? new Date();
    const scope = parseScope(input.scope);
    const draft = parseDraft(input.draft);
    if (
      (input.evaluationId !== null && !uuid.safeParse(input.evaluationId).success) ||
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
      payloadDigest: await digestValue({
        scope,
        evaluationId: input.evaluationId,
        expectedVersion: input.expectedVersion,
        draft,
      }),
      syncState: 'saved_device',
      updatedAt: now.toISOString(),
      expiresAt: addMilliseconds(now, DRAFT_TTL_MS),
    };
    options.onSyncState?.('saving_local');
    try {
      await this.database.transaction('rw', this.database.drafts, async () => {
        await this.database.drafts.put(record);
      });
      options.onSyncState?.('saved_device');
      return structuredClone(record);
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async loadDraft(scopeInput: EvaluationStorageScope): Promise<StoredEvaluationDraft | null> {
    const record = await this.database.drafts.get(scopeKey(parseScope(scopeInput)));
    return record ? structuredClone(record) : null;
  }

  async enqueueEvaluationMutation(
    input: EvaluationMutationInput,
    options: OperationTime = {},
  ): Promise<StoredEvaluationMutation> {
    const now = options.now ?? new Date();
    const scope = parseScope(input.scope);
    const draft = parseDraft(input.draft);
    const clientMutationId = input.clientMutationId ?? crypto.randomUUID();
    if (
      !uuid.safeParse(clientMutationId).success ||
      !uuid.safeParse(input.evaluationId).success ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    ) {
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation mutation context.');
    }
    const digest = await digestValue({
      scope,
      evaluationId: input.evaluationId,
      expectedVersion: input.expectedVersion,
      draft,
    });
    const timestamp = now.toISOString();
    const record: StoredEvaluationMutation = {
      storageKey: `${scopeKey(scope)}|${clientMutationId}`,
      clientMutationId,
      scopeKey: scopeKey(scope),
      scope,
      evaluationId: input.evaluationId,
      expectedVersion: input.expectedVersion,
      draft,
      payloadDigest: digest,
      status: 'pending',
      syncState: 'saved_device',
      createdAt: timestamp,
      updatedAt: timestamp,
      nextAttemptAt: timestamp,
      attemptCount: 0,
    };

    try {
      return await this.database.transaction('rw', this.database.mutations, async () => {
        const existing = await this.database.mutations
          .where('clientMutationId')
          .equals(clientMutationId)
          .first();
        if (existing) {
          if (existing.payloadDigest === digest) return structuredClone(existing);
          throw new EvaluationOfflineError(
            'mutation_id_conflict',
            'The client mutation ID is already bound to different content.',
          );
        }
        const unacknowledged = await this.database.mutations
          .filter((item) => item.status !== 'acknowledged')
          .count();
        if (unacknowledged >= MAX_UNACKNOWLEDGED_MUTATIONS) {
          throw new EvaluationOfflineError(
            'storage_limit',
            'Pending evaluation work reached the safe device limit.',
          );
        }
        await this.database.mutations.add(record);
        return structuredClone(record);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async nextPendingMutation(options: ClaimOptions = {}): Promise<StoredEvaluationMutation | null> {
    const now = options.now ?? new Date();
    const leaseOwner = options.leaseOwner ?? crypto.randomUUID();
    const leaseDuration = Math.max(1_000, options.leaseDurationMs ?? LEASE_MS);
    try {
      return await this.database.transaction('rw', this.database.mutations, async () => {
        const records = await this.database.mutations.toArray();
        const candidates = records
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
          );
        const candidate = candidates[0];
        if (!candidate) return null;
        const parsed = storedMutationSchema.safeParse(candidate);
        const expectedDigest = parsed.success
          ? await Dexie.waitFor(
              digestValue({
                scope: parsed.data.scope,
                evaluationId: parsed.data.evaluationId,
                expectedVersion: parsed.data.expectedVersion,
                draft: parsed.data.draft,
              }),
            )
          : null;
        if (!parsed.success || parsed.data.payloadDigest !== expectedDigest) {
          await this.database.mutations.update(candidate.storageKey, {
            status: 'needs_attention',
            syncState: 'needs_attention',
            errorCategory: 'corrupt_record',
            lastError: 'Stored mutation failed validation.',
            updatedAt: now.toISOString(),
          });
          throw new EvaluationOfflineError(
            'corrupt_record',
            'Stored evaluation work is malformed and was retained for recovery.',
          );
        }
        const claimed: StoredEvaluationMutation = {
          ...parsed.data,
          status: 'leased',
          syncState: 'syncing',
          leaseOwner,
          leaseUntil: addMilliseconds(now, leaseDuration),
          updatedAt: now.toISOString(),
        };
        await this.database.mutations.put(claimed);
        return structuredClone(claimed);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async acknowledgeMutation(input: {
    scope: EvaluationStorageScope;
    clientMutationId: string;
    evaluationId: string;
    serverVersion: number;
    acknowledgedAt: string;
  }): Promise<StoredEvaluationReceipt & { syncState: 'synced' }> {
    const scope = parseScope(input.scope);
    const acknowledgedAt = new Date(input.acknowledgedAt);
    if (
      !uuid.safeParse(input.clientMutationId).success ||
      !uuid.safeParse(input.evaluationId).success ||
      !Number.isSafeInteger(input.serverVersion) ||
      input.serverVersion < 1 ||
      Number.isNaN(acknowledgedAt.getTime())
    ) {
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation receipt.');
    }
    try {
      return await this.database.transaction(
        'rw',
        this.database.mutations,
        this.database.receipts,
        async () => {
          const mutation = await this.database.mutations
            .where('clientMutationId')
            .equals(input.clientMutationId)
            .first();
          if (!mutation)
            throw new EvaluationOfflineError(
              'mutation_not_found',
              'Evaluation mutation not found.',
            );
          const existingReceipt = await this.database.receipts
            .where('clientMutationId')
            .equals(input.clientMutationId)
            .first();
          if (existingReceipt) {
            if (
              existingReceipt.scopeKey === scopeKey(scope) &&
              existingReceipt.evaluationId === input.evaluationId &&
              existingReceipt.serverVersion === input.serverVersion
            ) {
              return { ...structuredClone(existingReceipt), syncState: 'synced' };
            }
            throw new EvaluationOfflineError(
              'receipt_mismatch',
              'Server receipt does not match the acknowledged mutation.',
            );
          }
          if (
            mutation.scopeKey !== scopeKey(scope) ||
            mutation.evaluationId !== input.evaluationId ||
            input.serverVersion !== mutation.expectedVersion + 1
          ) {
            throw new EvaluationOfflineError(
              'receipt_mismatch',
              'Server receipt does not match the queued mutation.',
            );
          }
          const receipt: StoredEvaluationReceipt = {
            storageKey: mutation.storageKey,
            clientMutationId: input.clientMutationId,
            scopeKey: mutation.scopeKey,
            scope,
            evaluationId: input.evaluationId,
            serverVersion: input.serverVersion,
            acknowledgedAt: acknowledgedAt.toISOString(),
            expiresAt: addMilliseconds(acknowledgedAt, RECEIPT_TTL_MS),
          };
          await this.database.receipts.put(receipt);
          await this.database.mutations.update(mutation.storageKey, {
            status: 'acknowledged',
            syncState: 'synced',
            acknowledgedAt: acknowledgedAt.toISOString(),
            updatedAt: acknowledgedAt.toISOString(),
            leaseOwner: undefined,
            leaseUntil: undefined,
          });
          return { ...structuredClone(receipt), syncState: 'synced' };
        },
      );
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async recordMutationFailure(
    clientMutationId: string,
    failure: {
      category: EvaluationMutationFailureCategory;
      message: string;
      now?: Date;
      leaseOwner: string;
    },
  ): Promise<StoredEvaluationMutation> {
    const terminal = ['conflict', 'forbidden', 'invalid_rubric', 'corrupt_record'].includes(
      failure.category,
    );
    return this.updateFailure(clientMutationId, failure, terminal, true);
  }

  async markNeedsAttention(
    clientMutationId: string,
    failure: {
      category: EvaluationMutationFailureCategory;
      message: string;
      now?: Date;
    },
  ): Promise<StoredEvaluationMutation> {
    return this.updateFailure(clientMutationId, failure, true, false);
  }

  private async updateFailure(
    clientMutationId: string,
    failure: {
      category: EvaluationMutationFailureCategory;
      message: string;
      now?: Date;
      leaseOwner?: string;
    },
    forceAttention: boolean,
    requireLease: boolean,
  ): Promise<StoredEvaluationMutation> {
    const now = failure.now ?? new Date();
    if (!uuid.safeParse(clientMutationId).success || failure.message.length > 500) {
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation failure details.');
    }
    try {
      return await this.database.transaction('rw', this.database.mutations, async () => {
        const mutation = await this.database.mutations
          .where('clientMutationId')
          .equals(clientMutationId)
          .first();
        if (!mutation)
          throw new EvaluationOfflineError('mutation_not_found', 'Evaluation mutation not found.');
        if (
          requireLease &&
          (mutation.status !== 'leased' || mutation.leaseOwner !== failure.leaseOwner)
        ) {
          throw new EvaluationOfflineError(
            'lease_mismatch',
            'The evaluation mutation is leased by another synchronization worker.',
          );
        }
        const attemptCount = mutation.attemptCount + 1;
        const needsAttention = forceAttention || attemptCount >= MAX_RETRY_ATTEMPTS;
        const updated: StoredEvaluationMutation = {
          ...mutation,
          status: needsAttention ? 'needs_attention' : 'pending',
          syncState: needsAttention ? 'needs_attention' : 'saved_device',
          attemptCount,
          nextAttemptAt: needsAttention
            ? now.toISOString()
            : addMilliseconds(now, 2 ** attemptCount * 1_000),
          updatedAt: now.toISOString(),
          errorCategory:
            attemptCount >= MAX_RETRY_ATTEMPTS && !forceAttention
              ? 'retry_exhausted'
              : failure.category,
          lastError: failure.message,
          leaseOwner: undefined,
          leaseUntil: undefined,
        };
        await this.database.mutations.put(updated);
        return structuredClone(updated);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async listMutations(scopeInput: EvaluationStorageScope): Promise<StoredEvaluationMutation[]> {
    const key = scopeKey(parseScope(scopeInput));
    return (await this.database.mutations.where('scopeKey').equals(key).sortBy('createdAt')).map(
      (record) => structuredClone(record),
    );
  }

  async clearAcknowledged(scopeInput?: EvaluationStorageScope): Promise<number> {
    const key = scopeInput ? scopeKey(parseScope(scopeInput)) : null;
    return this.database.transaction(
      'rw',
      this.database.mutations,
      this.database.receipts,
      async () => {
        const records = await this.database.mutations
          .filter((record) => record.status === 'acknowledged' && (!key || record.scopeKey === key))
          .toArray();
        const mutationKeys = records.map((record) => record.storageKey);
        const receiptKeys = (
          await this.database.receipts
            .where('clientMutationId')
            .anyOf(records.map((record) => record.clientMutationId))
            .toArray()
        ).map((receipt) => receipt.storageKey);
        await this.database.mutations.bulkDelete(mutationKeys);
        await this.database.receipts.bulkDelete(receiptKeys);
        return mutationKeys.length;
      },
    );
  }

  async teardownScope(scopeInput: EvaluationStorageScope): Promise<{
    cleared: boolean;
    retainedUnacknowledged: number;
  }> {
    const key = scopeKey(parseScope(scopeInput));
    await this.clearAcknowledged(scopeInput);
    const retained = await this.database.mutations
      .where('scopeKey')
      .equals(key)
      .filter((record) => record.status !== 'acknowledged')
      .count();
    if (retained > 0) return { cleared: false, retainedUnacknowledged: retained };
    await this.database.transaction(
      'rw',
      this.database.drafts,
      this.database.sessionContexts,
      this.database.receipts,
      async () => {
        await this.database.drafts.delete(key);
        await this.database.sessionContexts.delete(key);
        await this.database.receipts.where('scopeKey').equals(key).delete();
      },
    );
    return { cleared: true, retainedUnacknowledged: 0 };
  }

  async cleanupExpired(now = new Date()): Promise<{
    acknowledgedMutations: number;
    receipts: number;
    drafts: number;
    sessionContexts: number;
  }> {
    const timestamp = now.toISOString();
    return this.database.transaction(
      'rw',
      this.database.mutations,
      this.database.receipts,
      this.database.drafts,
      this.database.sessionContexts,
      async () => {
        const unacknowledgedScopeKeys = new Set(
          (
            await this.database.mutations
              .filter((record) => record.status !== 'acknowledged')
              .toArray()
          ).map((record) => record.scopeKey),
        );
        const expiredReceipts = await this.database.receipts
          .where('expiresAt')
          .belowOrEqual(timestamp)
          .toArray();
        const acknowledgedKeys: string[] = [];
        for (const receipt of expiredReceipts) {
          const mutation = await this.database.mutations.get(receipt.storageKey);
          if (mutation?.status === 'acknowledged') acknowledgedKeys.push(mutation.storageKey);
        }
        await this.database.mutations.bulkDelete(acknowledgedKeys);
        await this.database.receipts.bulkDelete(
          expiredReceipts.map((receipt) => receipt.storageKey),
        );

        const expiredDrafts = await this.database.drafts
          .where('expiresAt')
          .belowOrEqual(timestamp)
          .filter((record) => !unacknowledgedScopeKeys.has(record.scopeKey))
          .primaryKeys();
        const expiredContexts = await this.database.sessionContexts
          .where('expiresAt')
          .belowOrEqual(timestamp)
          .filter((record) => !unacknowledgedScopeKeys.has(record.scopeKey))
          .primaryKeys();
        await this.database.drafts.bulkDelete(expiredDrafts);
        await this.database.sessionContexts.bulkDelete(expiredContexts);

        return {
          acknowledgedMutations: acknowledgedKeys.length,
          receipts: expiredReceipts.length,
          drafts: expiredDrafts.length,
          sessionContexts: expiredContexts.length,
        };
      },
    );
  }

  async saveSessionContext(
    input: Omit<StoredSessionContext, 'scopeKey' | 'userId' | 'expiresAt'>,
    options: OperationTime = {},
  ): Promise<void> {
    const scope = parseScope(input.scope);
    const now = options.now ?? new Date();
    const context: StoredSessionContext = {
      scopeKey: scopeKey(scope),
      scope,
      userId: scope.userId,
      tryoutNumber: input.tryoutNumber,
      categories: structuredClone(input.categories),
      expiresAt: addMilliseconds(now, DRAFT_TTL_MS),
    };
    try {
      await this.database.sessionContexts.put(context);
    } catch (error) {
      throw mapStorageError(error);
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
  }> {
    const scope = parseScope(scopeInput);
    const records = await this.listMutations(scope);
    return {
      scope,
      mutations: records.map((record) => ({
        clientMutationId: record.clientMutationId,
        evaluationId: record.evaluationId,
        expectedVersion: record.expectedVersion,
        status: record.status,
        attemptCount: record.attemptCount,
        ...(record.errorCategory ? { errorCategory: record.errorCategory } : {}),
      })),
    };
  }

  async countRawMutations(): Promise<number> {
    return this.database.mutations.count();
  }
}

export function createEvaluationOfflineRepository(
  options: RepositoryOptions = {},
): EvaluationOfflineRepository {
  const indexedDb = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  const keyRange = options.keyRange === undefined ? globalThis.IDBKeyRange : options.keyRange;
  if (!indexedDb || !keyRange) {
    throw new EvaluationOfflineError(
      'storage_unavailable',
      'IndexedDB is unavailable; evaluation work has not been saved on this device.',
    );
  }
  return new EvaluationOfflineRepository(
    new EvaluationOfflineDatabase(
      options.databaseName ?? DEFAULT_EVALUATION_OFFLINE_DATABASE,
      indexedDb,
      keyRange,
    ),
  );
}
