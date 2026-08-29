import Dexie, { type IndexableType, type Transaction } from 'dexie';
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
  recoveryEnvelope,
  receiptTombstonePayload,
  storedDraftSchema,
  storedMutationSchema,
  storedQuarantineSchema,
  storedReceiptSchema,
  storedReceiptTombstoneSchema,
  storedQueueCounterSchema,
  storedSessionContextSchema,
  type EvaluationDraftPayload,
  type EvaluationStorageScope,
  type QuarantineReason,
  type QuarantineSource,
  type StoredEvaluationDraft,
  type StoredEvaluationMutation,
  type StoredEvaluationQuarantine,
  type StoredEvaluationReceipt,
  type StoredEvaluationReceiptTombstone,
  type StoredSessionContext,
} from './database';
import type { EvaluationSyncState } from './sync-state';

const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const LEASE_MS = 30_000;
const MAX_DRAFT_BYTES = 64 * 1_024;
const MAX_RETRY_ATTEMPTS = 5;
const uuid = z.uuid();
const publicFailureCategorySchema = z.enum([
  'network',
  'server',
  'conflict',
  'forbidden',
  'invalid_input',
  'invalid_rubric',
  'retry_exhausted',
  'corrupt_record',
]);

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
  | 'invalid_input'
  | 'invalid_rubric'
  | 'retry_exhausted'
  | 'corrupt_record';

export type AcknowledgedEvaluationEnqueueResult = {
  storageKey: string;
  clientMutationId: string;
  scopeKey: string;
  scope: EvaluationStorageScope;
  evaluationId: string;
  expectedVersion: number;
  payloadDigest: string;
  status: 'acknowledged';
  syncState: 'synced';
  serverVersion: number;
  acknowledgedAt: string;
  queueSequence?: never;
};

export type EvaluationDraftLineage = {
  state: 'saved_device' | 'synced' | 'needs_attention';
  repaired: boolean;
  draft: StoredEvaluationDraft | null;
  /** The newest durable mutation whose payload exactly backs the displayed draft. */
  mutation?: StoredEvaluationMutation;
  /** The earliest durable FIFO head that can block the displayed natural evaluation lineage. */
  blockingMutation?: StoredEvaluationMutation;
  receipt?: StoredEvaluationReceipt;
  confirmation?: {
    clientMutationId: string;
    evaluationId: string;
    serverVersion: number;
    payloadDigest: string;
  };
};

export type EvaluationQuotaName =
  | 'contexts'
  | 'drafts'
  | 'mutations'
  | 'unacknowledged_mutations'
  | 'acknowledged_mutations'
  | 'receipts'
  | 'receipt_tombstones'
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
  let result = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of value) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > 500) break;
    result += character;
    bytes += size;
  }
  return result;
}

function safeRecoverySourceKey(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const bounded = value.slice(0, maximum);
  const safe = bounded.split('|').every((part, index) => {
    if (index > 0 && part.startsWith('evaluation:')) {
      return uuid.safeParse(part.slice('evaluation:'.length)).success;
    }
    return uuid.safeParse(part).success;
  });
  return safe ? bounded : '';
}

function receiptPayload(receipt: Omit<StoredEvaluationReceipt, 'receiptDigest'>) {
  return receipt;
}

type QuarantineTrust = {
  physicalKey?: IndexableType;
  scope?: EvaluationStorageScope;
  clientMutationId?: string;
};

function indexableKeyPayload(value: unknown): unknown {
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
  if (value instanceof Date) return ['date', value.toISOString()];
  if (Array.isArray(value)) return ['array', value.map((part) => indexableKeyPayload(part))];
  if (value instanceof ArrayBuffer) return ['bytes', [...new Uint8Array(value)]];
  if (ArrayBuffer.isView(value)) {
    return ['bytes', [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]];
  }
  return ['unsupported'];
}

function digestUuid(hexDigest: string): string {
  return `${hexDigest.slice(0, 8)}-${hexDigest.slice(8, 12)}-5${hexDigest.slice(13, 16)}-8${hexDigest.slice(17, 20)}-${hexDigest.slice(20, 32)}`;
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
    const [contexts, drafts, mutations, receipts, receiptTombstones, quarantines, queueCounters] =
      await Promise.all([
        transaction.table('sessionContexts').toArray(),
        transaction.table('drafts').toArray(),
        transaction.table('mutations').toArray(),
        transaction.table('receipts').toArray(),
        transaction.table('receiptTombstones').toArray(),
        transaction.table('quarantines').toArray(),
        transaction.table('queueCounters').toArray(),
      ]);
    return { contexts, drafts, mutations, receipts, receiptTombstones, quarantines, queueCounters };
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
    trust: QuarantineTrust = {},
  ): StoredEvaluationQuarantine {
    const rawObject = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const parsedScope = evaluationScopeSchema.safeParse(rawObject.scope);
    const parsedScopeKey =
      parsedScope.success && parsedScope.data.userId === this.authenticatedUserId
        ? scopeKey(parsedScope.data)
        : undefined;
    const rawCounterScopeKey =
      sourceTable === 'queueCounters' &&
      typeof rawObject.scopeKey === 'string' &&
      rawObject.scopeKey.startsWith(`${this.authenticatedUserId}|`) &&
      safeRecoverySourceKey(rawObject.scopeKey, 512)
        ? safeRecoverySourceKey(rawObject.scopeKey, 512)
        : undefined;
    const callerScopeKey = trust.scope ? scopeKey(trust.scope) : undefined;
    const trustedScopeKey = callerScopeKey ?? parsedScopeKey ?? rawCounterScopeKey;
    const sourceKeyCandidate =
      sourceTable === 'mutations' ||
      sourceTable === 'receipts' ||
      sourceTable === 'receiptTombstones'
        ? (rawObject.storageKey ?? rawObject.clientMutationId)
        : sourceTable === 'queueCounters'
          ? rawObject.queueKey
          : rawObject.scopeKey;
    const boundedSourceKey = safeRecoverySourceKey(
      typeof trust.physicalKey === 'string' ? trust.physicalKey : sourceKeyCandidate,
      600,
    );
    const envelope = recoveryEnvelope(raw);
    const candidate = {
      quarantineKey: crypto.randomUUID(),
      ...(trustedScopeKey ? { scopeKey: trustedScopeKey } : {}),
      sourceTable,
      sourceKey: boundedSourceKey,
      reason,
      diagnostic: safeDiagnostic(diagnostic),
      status: 'needs_attention',
      createdAt: now.toISOString(),
      recoveryEnvelope: {
        ...envelope,
        ...(trustedScopeKey ? { scopeKey: trustedScopeKey } : {}),
        ...(trust.clientMutationId ? { clientMutationId: trust.clientMutationId } : {}),
      },
    };
    const parsed = storedQuarantineSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    return storedQuarantineSchema.parse({
      quarantineKey: crypto.randomUUID(),
      sourceTable,
      sourceKey: '',
      reason,
      diagnostic: 'Recovery metadata was reduced to a safe minimal record.',
      status: 'needs_attention',
      createdAt: now.toISOString(),
      recoveryEnvelope: {},
    });
  }

  private async moveToQuarantine(
    transaction: AllTablesTransaction,
    sourceTable: QuarantineSource,
    raw: unknown,
    reason: QuarantineReason,
    diagnostic: string,
    now: Date,
    trust: QuarantineTrust = {},
  ): Promise<void> {
    const quarantineRecord = this.makeQuarantine(sourceTable, raw, reason, diagnostic, now, trust);
    const quarantineCount = await transaction.table('quarantines').count();
    if (quarantineCount >= this.quotas.maxQuarantines) throw quotaError('quarantines');
    const rawObject = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const deletionKey =
      sourceTable === 'mutations' ||
      sourceTable === 'receipts' ||
      sourceTable === 'receiptTombstones'
        ? (rawObject.storageKey ?? rawObject.clientMutationId)
        : sourceTable === 'queueCounters'
          ? rawObject.queueKey
          : rawObject.scopeKey;
    const physicalDeletionKey: IndexableType | undefined =
      trust.physicalKey ?? (typeof deletionKey === 'string' ? deletionKey : undefined);
    if (physicalDeletionKey !== undefined) {
      await transaction.table<unknown, IndexableType>(sourceTable).delete(physicalDeletionKey);
    }
    await this.assertByteQuota(transaction, quarantineRecord);
    await transaction.table('quarantines').add(storedQuarantineSchema.parse(quarantineRecord));
  }

  private async addToQuarantine(
    transaction: AllTablesTransaction,
    sourceTable: QuarantineSource,
    raw: unknown,
    reason: QuarantineReason,
    diagnostic: string,
    now: Date,
    trust: QuarantineTrust = {},
  ): Promise<void> {
    const quarantineRecord = this.makeQuarantine(sourceTable, raw, reason, diagnostic, now, trust);
    const duplicate = await transaction
      .table('quarantines')
      .filter(
        (record) =>
          record.sourceTable === sourceTable &&
          record.sourceKey === quarantineRecord.sourceKey &&
          record.reason === reason &&
          JSON.stringify(record.recoveryEnvelope) ===
            JSON.stringify(quarantineRecord.recoveryEnvelope),
      )
      .first();
    if (duplicate) return;
    if ((await transaction.table('quarantines').count()) >= this.quotas.maxQuarantines) {
      throw quotaError('quarantines');
    }
    await this.assertByteQuota(transaction, quarantineRecord);
    await transaction.table('quarantines').add(storedQuarantineSchema.parse(quarantineRecord));
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

  private async validateReceiptRecord(
    raw: unknown,
    expected?: { scope: EvaluationStorageScope; clientMutationId: string },
  ): Promise<StoredEvaluationReceipt> {
    const parsed = storedReceiptSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.scope.userId !== this.authenticatedUserId ||
      parsed.data.scopeKey !== scopeKey(parsed.data.scope) ||
      parsed.data.storageKey !== `${scopeKey(parsed.data.scope)}|${parsed.data.clientMutationId}` ||
      (expected !== undefined &&
        (parsed.data.scopeKey !== scopeKey(expected.scope) ||
          parsed.data.clientMutationId !== expected.clientMutationId ||
          parsed.data.storageKey !== `${scopeKey(expected.scope)}|${expected.clientMutationId}`))
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

  private async validateReceiptTombstone(
    raw: unknown,
    scope: EvaluationStorageScope,
    clientMutationId: string,
  ): Promise<StoredEvaluationReceiptTombstone> {
    const parsed = storedReceiptTombstoneSchema.safeParse(raw);
    const storageKey = `${scopeKey(scope)}|${clientMutationId}`;
    if (
      !parsed.success ||
      parsed.data.storageKey !== storageKey ||
      parsed.data.scopeKey !== scopeKey(scope) ||
      parsed.data.clientMutationId !== clientMutationId
    ) {
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored terminal receipt tombstone failed validation.',
      );
    }
    const { tombstoneDigest, ...payload } = parsed.data;
    const expectedDigest = await Dexie.waitFor(digestValue(receiptTombstonePayload(payload)));
    if (tombstoneDigest !== expectedDigest) {
      throw new EvaluationOfflineError(
        'corrupt_record',
        'Stored terminal receipt tombstone digest does not match.',
      );
    }
    return parsed.data;
  }

  private async ensureReceiptTombstone(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
    clientMutationId: string,
    now: Date,
    receipt?: StoredEvaluationReceipt,
  ): Promise<StoredEvaluationReceiptTombstone> {
    const storageKey = `${scopeKey(scope)}|${clientMutationId}`;
    const rawExisting = await this.database.receiptTombstones.get(storageKey);
    if (rawExisting) {
      try {
        return await this.validateReceiptTombstone(rawExisting, scope, clientMutationId);
      } catch {
        await this.addToQuarantine(
          transaction,
          'receiptTombstones',
          rawExisting,
          'digest_mismatch',
          'A corrupt terminal tombstone was replaced by a deterministic fence.',
          now,
          { physicalKey: storageKey, scope, clientMutationId },
        );
      }
    }
    const withoutDigest: Omit<StoredEvaluationReceiptTombstone, 'tombstoneDigest'> = receipt
      ? {
          storageKey,
          scopeKey: scopeKey(scope),
          clientMutationId,
          reason: 'receipt_authority',
          createdAt: receipt.acknowledgedAt,
          evaluationId: receipt.evaluationId,
          expectedVersion: receipt.expectedVersion,
          payloadDigest: receipt.payloadDigest,
          serverVersion: receipt.serverVersion,
          acknowledgedAt: receipt.acknowledgedAt,
        }
      : {
          storageKey,
          scopeKey: scopeKey(scope),
          clientMutationId,
          reason: 'corrupt_receipt',
          createdAt: now.toISOString(),
        };
    const candidate = storedReceiptTombstoneSchema.parse({
      ...withoutDigest,
      tombstoneDigest: await Dexie.waitFor(digestValue(receiptTombstonePayload(withoutDigest))),
    });
    await this.assertByteQuota(transaction, candidate);
    await this.database.receiptTombstones.put(candidate);
    return candidate;
  }

  private async ensureConflictResolutionTombstone(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
    clientMutationId: string,
    reason: 'conflict_keep_local' | 'conflict_use_server' | 'conflict_dependent',
    now: Date,
    resolution?: Pick<
      StoredEvaluationReceiptTombstone,
      | 'resolutionOriginalEvaluationId'
      | 'resolutionOriginalPayloadDigest'
      | 'resolutionOriginalQueueSequence'
      | 'resolutionServerEvaluationId'
      | 'resolutionServerVersion'
      | 'resolutionServerSnapshotDigest'
      | 'resolutionResultMutationId'
      | 'resolutionResultQueueSequence'
      | 'resolutionResultDraftDigest'
      | 'resolutionResultPayloadDigest'
      | 'resolutionResultMarker'
    >,
  ): Promise<StoredEvaluationReceiptTombstone> {
    const storageKey = `${scopeKey(scope)}|${clientMutationId}`;
    const rawExisting = await this.database.receiptTombstones.get(storageKey);
    if (rawExisting) {
      const existing = await this.validateReceiptTombstone(rawExisting, scope, clientMutationId);
      if (existing.reason !== reason)
        throw new EvaluationOfflineError(
          'invalid_transition',
          'Conflict resolution action does not match its durable terminal record.',
        );
      if (resolution) {
        for (const [key, value] of Object.entries(resolution)) {
          if (existing[key as keyof StoredEvaluationReceiptTombstone] !== value)
            throw new EvaluationOfflineError(
              'invalid_transition',
              'Conflict resolution does not match its durable server snapshot and result.',
            );
        }
      }
      return existing;
    }
    const withoutDigest: Omit<StoredEvaluationReceiptTombstone, 'tombstoneDigest'> = {
      storageKey,
      scopeKey: scopeKey(scope),
      clientMutationId,
      reason,
      createdAt: now.toISOString(),
      ...resolution,
    };
    const candidate = storedReceiptTombstoneSchema.parse({
      ...withoutDigest,
      tombstoneDigest: await Dexie.waitFor(digestValue(receiptTombstonePayload(withoutDigest))),
    });
    await this.assertByteQuota(transaction, candidate);
    await this.database.receiptTombstones.put(candidate);
    return candidate;
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
      this.database.receiptTombstones,
      this.database.quarantines,
      this.database.queueCounters,
    ] as const;
  }

  private async physicallyScopedTombstones(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
  ): Promise<Array<{ physicalKey: string; clientMutationId: string; raw: unknown }>> {
    const prefix = `${scopeKey(scope)}|`;
    const table = transaction.table<unknown, IndexableType>('receiptTombstones');
    const allKeys = await table.toCollection().primaryKeys();
    const physicalKeys = allKeys.filter(
      (key): key is string => typeof key === 'string' && key.startsWith(prefix),
    );
    const records = await table.bulkGet(physicalKeys);
    return physicalKeys.flatMap((physicalKey, index) => {
      const raw = records[index];
      if (raw === undefined) return [];
      return [
        {
          physicalKey,
          clientMutationId: physicalKey.slice(prefix.length),
          raw,
        },
      ];
    });
  }

  private async repairedQuarantineKey(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
    physicalKey: IndexableType,
  ): Promise<string> {
    const table = transaction.table<unknown, IndexableType>('quarantines');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const digest = await Dexie.waitFor(
        digestValue({
          purpose: 'tryoutflow-quarantine-repair-v1',
          scopeKey: scopeKey(scope),
          physicalKey: indexableKeyPayload(physicalKey),
          attempt,
        }),
      );
      const candidate = digestUuid(digest);
      if ((await table.get(candidate)) === undefined) return candidate;
    }
    throw new EvaluationOfflineError(
      'corrupt_record',
      'Malformed quarantine metadata could not be assigned a bounded repair key.',
    );
  }

  private tombstoneMatchesMutation(
    tombstone: StoredEvaluationReceiptTombstone,
    mutation: Pick<
      StoredEvaluationMutation,
      'evaluationId' | 'expectedVersion' | 'payloadDigest' | 'clientMutationId' | 'storageKey'
    >,
  ): boolean {
    return (
      tombstone.reason === 'receipt_authority' &&
      tombstone.storageKey === mutation.storageKey &&
      tombstone.clientMutationId === mutation.clientMutationId &&
      tombstone.evaluationId === mutation.evaluationId &&
      tombstone.expectedVersion === mutation.expectedVersion &&
      tombstone.payloadDigest === mutation.payloadDigest &&
      tombstone.serverVersion === mutation.expectedVersion + 1 &&
      tombstone.acknowledgedAt !== undefined
    );
  }

  private acknowledgedFromTombstone(
    tombstone: StoredEvaluationReceiptTombstone,
    mutation: Pick<
      StoredEvaluationMutation,
      | 'scope'
      | 'scopeKey'
      | 'storageKey'
      | 'clientMutationId'
      | 'evaluationId'
      | 'expectedVersion'
      | 'payloadDigest'
    >,
  ): AcknowledgedEvaluationEnqueueResult | null {
    if (!this.tombstoneMatchesMutation(tombstone, mutation)) return null;
    return {
      storageKey: mutation.storageKey,
      clientMutationId: mutation.clientMutationId,
      scopeKey: mutation.scopeKey,
      scope: mutation.scope,
      evaluationId: mutation.evaluationId,
      expectedVersion: mutation.expectedVersion,
      payloadDigest: mutation.payloadDigest,
      status: 'acknowledged',
      syncState: 'synced',
      serverVersion: tombstone.serverVersion!,
      acknowledgedAt: tombstone.acknowledgedAt!,
    };
  }

  private async validateQueueLineage(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
    mutations: StoredEvaluationMutation[],
    now: Date,
  ): Promise<boolean> {
    const queues = new Map<string, StoredEvaluationMutation[]>();
    for (const mutation of mutations) {
      const queue = queues.get(mutation.queueKey) ?? [];
      queue.push(mutation);
      queues.set(mutation.queueKey, queue);
    }
    let valid = true;
    for (const [queueKey, queue] of queues) {
      const rawCounter = await this.database.queueCounters.get(queueKey);
      if (!rawCounter) {
        await this.addToQuarantine(
          transaction,
          'queueCounters',
          { queueKey, scopeKey: scopeKey(scope), status: 'needs_attention' },
          'invalid_record',
          'Queue sequence lineage is missing for stored work.',
          now,
        );
        valid = false;
        continue;
      }
      const parsed = storedQueueCounterSchema.safeParse(rawCounter);
      const maximumSequence = Math.max(...queue.map((mutation) => mutation.queueSequence));
      if (
        !parsed.success ||
        parsed.data.queueKey !== queueKey ||
        parsed.data.scopeKey !== scopeKey(scope) ||
        parsed.data.nextSequence <= maximumSequence
      ) {
        await this.moveToQuarantine(
          transaction,
          'queueCounters',
          rawCounter,
          'invalid_record',
          'Queue sequence counter does not exactly continue its stored lineage.',
          now,
        );
        valid = false;
      }
      const bySequence = new Map<number, StoredEvaluationMutation[]>();
      for (const mutation of queue) {
        const sameSequence = bySequence.get(mutation.queueSequence) ?? [];
        sameSequence.push(mutation);
        bySequence.set(mutation.queueSequence, sameSequence);
      }
      for (const duplicates of bySequence.values()) {
        if (duplicates.length < 2) continue;
        valid = false;
        for (const duplicate of duplicates) {
          await this.addToQuarantine(
            transaction,
            'mutations',
            duplicate,
            'invalid_record',
            'Multiple mutations claim the same queue sequence.',
            now,
          );
        }
      }
    }
    return valid;
  }

  private async validateQueueForStrictAppend(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
    queueKey: string,
    now: Date,
  ): Promise<number> {
    const rawRows = await this.database.mutations
      .where('scopeKey')
      .equals(scopeKey(scope))
      .toArray();
    const rows: StoredEvaluationMutation[] = [];
    for (const raw of rawRows) {
      const row = await this.validateMutationRecord(raw);
      if (row.scopeKey !== scopeKey(scope)) {
        throw new EvaluationOfflineError('corrupt_record', 'Target queue scope is invalid.');
      }
      if (row.queueKey === queueKey) rows.push(row);
    }
    const physicalPrefix = `${scopeKey(scope)}|`;
    const receipts = new Map<string, StoredEvaluationReceipt>();
    const rawReceipts = await this.database.receipts
      .filter(
        (record) =>
          typeof record.storageKey === 'string' && record.storageKey.startsWith(physicalPrefix),
      )
      .toArray();
    for (const raw of rawReceipts) {
      const physicalStorageKey = (raw as { storageKey: string }).storageKey;
      const clientMutationId = physicalStorageKey.slice(physicalPrefix.length);
      receipts.set(
        physicalStorageKey,
        await this.validateReceiptRecord(raw, { scope, clientMutationId }),
      );
    }
    const tombstones = new Map<string, StoredEvaluationReceiptTombstone>();
    for (const { physicalKey, clientMutationId, raw } of await this.physicallyScopedTombstones(
      transaction,
      scope,
    )) {
      tombstones.set(
        physicalKey,
        await this.validateReceiptTombstone(raw, scope, clientMutationId),
      );
    }
    for (const [storageKey, receipt] of receipts) {
      const tombstone = tombstones.get(storageKey);
      if (!tombstone) continue;
      if (
        tombstone.reason !== 'receipt_authority' ||
        !this.tombstoneMatchesMutation(tombstone, receipt) ||
        tombstone.serverVersion !== receipt.serverVersion ||
        tombstone.acknowledgedAt !== receipt.acknowledgedAt
      )
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Target terminal receipt and tombstone lineage diverge.',
        );
    }
    const rawQuarantines = await this.database.quarantines
      .where('scopeKey')
      .equals(scopeKey(scope))
      .toArray();
    for (const raw of rawQuarantines) {
      const parsed = storedQuarantineSchema.safeParse(raw);
      if (!parsed.success || parsed.data.scopeKey !== scopeKey(scope))
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Target recovery quarantine metadata is invalid.',
        );
    }
    if (!(await this.validateQueueLineage(transaction, scope, rows, now))) {
      throw new EvaluationOfflineError('corrupt_record', 'Target queue lineage is invalid.');
    }
    rows.sort((left, right) => left.queueSequence - right.queueSequence);
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index]!.queueSequence !== rows[index - 1]!.queueSequence + 1) {
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Target queue contains an unproven sequence gap.',
        );
      }
    }
    const rawCounter = await this.database.queueCounters.get(queueKey);
    if (!rawCounter) {
      if (rows.length > 0)
        throw new EvaluationOfflineError('corrupt_record', 'Target queue counter is missing.');
      return 1;
    }
    const parsedCounter = storedQueueCounterSchema.safeParse(rawCounter);
    const maximum = rows.at(-1)?.queueSequence ?? 0;
    if (
      !parsedCounter.success ||
      parsedCounter.data.scopeKey !== scopeKey(scope) ||
      parsedCounter.data.queueKey !== queueKey ||
      (rows.length > 0 && parsedCounter.data.nextSequence !== maximum + 1) ||
      parsedCounter.data.nextSequence >= Number.MAX_SAFE_INTEGER
    ) {
      throw new EvaluationOfflineError('corrupt_record', 'Target queue counter is invalid.');
    }

    return parsedCounter.data.nextSequence;
  }

  private async appendFreshMutation(
    transaction: AllTablesTransaction,
    scope: EvaluationStorageScope,
    baseRecord: Omit<StoredEvaluationMutation, 'queueSequence'>,
    now: Date,
  ): Promise<StoredEvaluationMutation> {
    if (
      (await this.database.mutations.get(baseRecord.storageKey)) ||
      (await this.database.receipts.get(baseRecord.storageKey)) ||
      (await this.database.receiptTombstones.get(baseRecord.storageKey))
    ) {
      throw new EvaluationOfflineError(
        'mutation_id_conflict',
        'The client mutation ID already has durable lineage.',
      );
    }
    const allMutations = await this.database.mutations.toArray();
    if (allMutations.length >= this.quotas.maxMutations) throw quotaError('mutations');
    if (
      allMutations.filter((item) => item.status !== 'acknowledged').length >=
      this.quotas.maxUnacknowledgedMutations
    )
      throw quotaError('unacknowledged_mutations');
    const rawQueue = allMutations.filter((item) => item.queueKey === baseRecord.queueKey);
    const queue: StoredEvaluationMutation[] = [];
    for (const raw of rawQueue) queue.push(await this.validateMutationRecord(raw));
    if (!(await this.validateQueueLineage(transaction, scope, queue, now))) {
      throw new EvaluationOfflineError('corrupt_record', 'Queue lineage is invalid.');
    }
    const maximum = queue.reduce((value, mutation) => Math.max(value, mutation.queueSequence), 0);
    const rawCounter = await this.database.queueCounters.get(baseRecord.queueKey);
    const parsedCounter = rawCounter ? storedQueueCounterSchema.safeParse(rawCounter) : null;
    if (
      parsedCounter &&
      (!parsedCounter.success ||
        parsedCounter.data.scopeKey !== scopeKey(scope) ||
        parsedCounter.data.nextSequence <= maximum ||
        parsedCounter.data.nextSequence >= Number.MAX_SAFE_INTEGER)
    ) {
      throw new EvaluationOfflineError('corrupt_record', 'Queue counter is invalid.');
    }
    if (!rawCounter && maximum > 0) {
      throw new EvaluationOfflineError('corrupt_record', 'Queue counter is missing.');
    }
    const queueSequence = parsedCounter?.success ? parsedCounter.data.nextSequence : 1;
    const mutation: StoredEvaluationMutation = { ...baseRecord, queueSequence };
    await this.assertByteQuota(transaction, mutation);
    await this.database.queueCounters.put({
      queueKey: mutation.queueKey,
      scopeKey: mutation.scopeKey,
      nextSequence: queueSequence + 1,
    });
    await this.database.mutations.add(mutation);
    return structuredClone(mutation);
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
        this.allTables(),
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
      result = await this.database.transaction('rw', this.allTables(), async (transaction) => {
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

  async saveDraftAndEnqueueMutation(
    input: EvaluationMutationInput,
    options: OperationTime = {},
  ): Promise<{
    draft: StoredEvaluationDraft;
    mutation: StoredEvaluationMutation | AcknowledgedEvaluationEnqueueResult;
  }> {
    const scope = this.parseScope(input.scope);
    const draftPayload = this.parseDraft(input.draft);
    const now = safeDate(options.now ?? new Date());
    const clientMutationId = input.clientMutationId ?? crypto.randomUUID();
    if (
      !uuid.safeParse(clientMutationId).success ||
      !uuid.safeParse(input.evaluationId).success ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    )
      throw new EvaluationOfflineError('invalid_input', 'Invalid evaluation mutation context.');
    const timestamp = now.toISOString();
    const payloadDigest = await digestValue(
      evaluationPayload(scope, input.evaluationId, input.expectedVersion, draftPayload),
    );
    const draft: StoredEvaluationDraft = {
      scopeKey: scopeKey(scope),
      scope,
      evaluationId: input.evaluationId,
      expectedVersion: input.expectedVersion,
      draft: draftPayload,
      payloadDigest,
      syncState: 'saved_device',
      updatedAt: timestamp,
      expiresAt: addMilliseconds(now, DRAFT_TTL_MS),
    };
    const baseMutation: Omit<StoredEvaluationMutation, 'queueSequence'> = {
      storageKey: `${scopeKey(scope)}|${clientMutationId}`,
      clientMutationId,
      scopeKey: scopeKey(scope),
      queueKey: evaluationQueueKey(scope, input.evaluationId),
      scope,
      evaluationId: input.evaluationId,
      expectedVersion: input.expectedVersion,
      draft: draftPayload,
      payloadDigest,
      status: 'pending',
      syncState: 'saved_device',
      createdAt: timestamp,
      updatedAt: timestamp,
      nextAttemptAt: timestamp,
      attemptCount: 0,
    };
    notify(options, 'saving_local');
    try {
      const result = await this.database.transaction(
        'rw',
        this.allTables(),
        async (transaction) => {
          const context = await this.requireContext(transaction, scope);
          this.assertDraftMatchesContext(draftPayload, context);
          const existingDraft = await this.database.drafts.get(draft.scopeKey);
          if (!existingDraft && (await this.database.drafts.count()) >= this.quotas.maxDrafts)
            throw quotaError('drafts');
          const mutation = await this.appendFreshMutation(transaction, scope, baseMutation, now);
          await this.assertByteQuota(transaction, draft);
          await this.database.drafts.put(draft);
          return { draft: structuredClone(draft), mutation };
        },
      );
      notify(options, result.mutation.status === 'acknowledged' ? 'synced' : 'saved_device');
      return result;
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async reconcileDraftLineage(scopeInput: EvaluationStorageScope): Promise<EvaluationDraftLineage> {
    const scope = this.parseScope(scopeInput);
    const key = scopeKey(scope);
    try {
      return await this.database.transaction('rw', this.allTables(), async (transaction) => {
        const rawDraft = await this.database.drafts.get(key);
        if (!rawDraft) return { state: 'saved_device', repaired: false, draft: null };
        let storedDraft = await this.validateDraftRecord(rawDraft, scope);
        const context = await this.requireContext(transaction, scope);
        this.assertDraftMatchesContext(storedDraft.draft, context);
        const rawMutations = await this.database.mutations.where('scopeKey').equals(key).toArray();
        const mutations: StoredEvaluationMutation[] = [];
        for (const raw of rawMutations) mutations.push(await this.validateMutationRecord(raw));
        if (!(await this.validateQueueLineage(transaction, scope, mutations, new Date()))) {
          throw new EvaluationOfflineError('corrupt_record', 'Draft queue lineage is invalid.');
        }

        const exactMutation = mutations
          .filter(
            (mutation) =>
              mutation.evaluationId === storedDraft.evaluationId &&
              mutation.expectedVersion === storedDraft.expectedVersion &&
              mutation.payloadDigest === storedDraft.payloadDigest &&
              mutation.status !== 'acknowledged',
          )
          .sort((left, right) => right.queueSequence - left.queueSequence)[0];
        if (exactMutation) {
          const relatedEvaluationIds = new Set([exactMutation.evaluationId]);
          let addedRelatedId = true;
          while (addedRelatedId) {
            addedRelatedId = false;
            for (const mutation of mutations) {
              const related =
                relatedEvaluationIds.has(mutation.evaluationId) ||
                (mutation.conflictServerEvaluationId !== undefined &&
                  relatedEvaluationIds.has(mutation.conflictServerEvaluationId));
              if (!related) continue;
              for (const evaluationId of [
                mutation.evaluationId,
                mutation.conflictServerEvaluationId,
              ]) {
                if (evaluationId && !relatedEvaluationIds.has(evaluationId)) {
                  relatedEvaluationIds.add(evaluationId);
                  addedRelatedId = true;
                }
              }
            }
          }
          const queueHeads = new Map<string, StoredEvaluationMutation>();
          for (const mutation of mutations) {
            if (
              mutation.status === 'acknowledged' ||
              !relatedEvaluationIds.has(mutation.evaluationId)
            )
              continue;
            const current = queueHeads.get(mutation.queueKey);
            if (!current || mutation.queueSequence < current.queueSequence)
              queueHeads.set(mutation.queueKey, mutation);
          }
          const blockingMutation = [...queueHeads.values()].sort(
            (left, right) =>
              Number(left.status !== 'needs_attention') -
                Number(right.status !== 'needs_attention') ||
              left.createdAt.localeCompare(right.createdAt) ||
              left.queueSequence - right.queueSequence ||
              left.storageKey.localeCompare(right.storageKey),
          )[0];
          if (storedDraft.syncState !== 'saved_device') {
            storedDraft = { ...storedDraft, syncState: 'saved_device' };
            await this.database.drafts.put(storedDraft);
          }
          return {
            state:
              blockingMutation?.status === 'needs_attention' ? 'needs_attention' : 'saved_device',
            repaired: false,
            draft: structuredClone(storedDraft),
            mutation: structuredClone(exactMutation),
            ...(blockingMutation ? { blockingMutation: structuredClone(blockingMutation) } : {}),
          };
        }

        if (storedDraft.evaluationId) {
          const prefix = `${key}|`;
          const rawReceipts = await this.database.receipts
            .filter(
              (record) =>
                typeof record.storageKey === 'string' && record.storageKey.startsWith(prefix),
            )
            .toArray();
          for (const raw of rawReceipts) {
            const clientMutationId = raw.storageKey.slice(prefix.length);
            const receipt = await this.validateReceiptRecord(raw, { scope, clientMutationId });
            const draftDigestAtReceiptVersion = await Dexie.waitFor(
              digestValue(
                evaluationPayload(
                  scope,
                  storedDraft.evaluationId,
                  receipt.expectedVersion,
                  storedDraft.draft,
                ),
              ),
            );
            if (
              receipt.evaluationId === storedDraft.evaluationId &&
              receipt.serverVersion === storedDraft.expectedVersion &&
              receipt.payloadDigest === draftDigestAtReceiptVersion
            ) {
              if (storedDraft.syncState !== 'synced') {
                storedDraft = { ...storedDraft, syncState: 'synced' };
                await this.database.drafts.put(storedDraft);
              }
              return {
                state: 'synced',
                repaired: false,
                draft: structuredClone(storedDraft),
                receipt: structuredClone(receipt),
                confirmation: {
                  clientMutationId: receipt.clientMutationId,
                  evaluationId: receipt.evaluationId,
                  serverVersion: receipt.serverVersion,
                  payloadDigest: receipt.payloadDigest,
                },
              };
            }
          }
          for (const { clientMutationId, raw } of await this.physicallyScopedTombstones(
            transaction,
            scope,
          )) {
            const tombstone = await this.validateReceiptTombstone(raw, scope, clientMutationId);
            if (
              tombstone.reason !== 'receipt_authority' ||
              tombstone.evaluationId !== storedDraft.evaluationId ||
              tombstone.serverVersion !== storedDraft.expectedVersion ||
              tombstone.expectedVersion === undefined ||
              tombstone.payloadDigest === undefined
            )
              continue;
            const draftDigestAtReceiptVersion = await Dexie.waitFor(
              digestValue(
                evaluationPayload(
                  scope,
                  storedDraft.evaluationId,
                  tombstone.expectedVersion,
                  storedDraft.draft,
                ),
              ),
            );
            if (tombstone.payloadDigest === draftDigestAtReceiptVersion) {
              if (storedDraft.syncState !== 'synced') {
                storedDraft = { ...storedDraft, syncState: 'synced' };
                await this.database.drafts.put(storedDraft);
              }
              return {
                state: 'synced',
                repaired: false,
                draft: structuredClone(storedDraft),
                confirmation: {
                  clientMutationId: tombstone.clientMutationId,
                  evaluationId: tombstone.evaluationId,
                  serverVersion: tombstone.serverVersion,
                  payloadDigest: tombstone.payloadDigest,
                },
              };
            }
          }
        }

        if (storedDraft.syncState === 'saved_device' && storedDraft.evaluationId) {
          const clientMutationId = crypto.randomUUID();
          const recoveredAt = new Date(storedDraft.updatedAt);
          const mutation = await this.appendFreshMutation(
            transaction,
            scope,
            {
              storageKey: `${key}|${clientMutationId}`,
              clientMutationId,
              scopeKey: key,
              queueKey: evaluationQueueKey(scope, storedDraft.evaluationId),
              scope,
              evaluationId: storedDraft.evaluationId,
              expectedVersion: storedDraft.expectedVersion,
              draft: storedDraft.draft,
              payloadDigest: storedDraft.payloadDigest,
              status: 'pending',
              syncState: 'saved_device',
              createdAt: storedDraft.updatedAt,
              updatedAt: storedDraft.updatedAt,
              nextAttemptAt: recoveredAt.toISOString(),
              attemptCount: 0,
            },
            recoveredAt,
          );
          return {
            state: 'saved_device',
            repaired: true,
            draft: structuredClone(storedDraft),
            mutation: structuredClone(mutation),
          };
        }

        storedDraft = { ...storedDraft, syncState: 'needs_attention' };
        await this.database.drafts.put(storedDraft);
        return {
          state: 'needs_attention',
          repaired: false,
          draft: structuredClone(storedDraft),
        };
      });
    } catch (error) {
      throw mapStorageError(error, 'read');
    }
  }

  async loadDraft(scopeInput: EvaluationStorageScope): Promise<StoredEvaluationDraft | null> {
    const scope = this.parseScope(scopeInput);
    let corruption = false;
    try {
      const result = await this.database.transaction(
        'rw',
        this.allTables(),
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
  ): Promise<StoredEvaluationMutation | AcknowledgedEvaluationEnqueueResult> {
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
    const baseRecord = {
      storageKey: `${scopeKey(scope)}|${clientMutationId}`,
      clientMutationId,
      scopeKey: scopeKey(scope),
      queueKey: evaluationQueueKey(scope, input.evaluationId),
      scope,
      evaluationId: input.evaluationId,
      expectedVersion: input.expectedVersion,
      draft,
      payloadDigest,
      status: 'pending' as const,
      syncState: 'saved_device' as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      nextAttemptAt: timestamp,
      attemptCount: 0,
    };
    let corruption = false;
    let receiptMismatch = false;
    try {
      const result = await this.database.transaction(
        'rw',
        this.allTables(),
        async (transaction) => {
          const existingReceiptRaw = await this.database.receipts.get(baseRecord.storageKey);
          if (existingReceiptRaw) {
            try {
              const existingReceipt = await this.validateReceiptRecord(existingReceiptRaw, {
                scope,
                clientMutationId,
              });
              await this.ensureReceiptTombstone(
                transaction,
                scope,
                clientMutationId,
                now,
                existingReceipt,
              );
              const exact =
                existingReceipt.storageKey === baseRecord.storageKey &&
                existingReceipt.scopeKey === baseRecord.scopeKey &&
                existingReceipt.evaluationId === baseRecord.evaluationId &&
                existingReceipt.expectedVersion === baseRecord.expectedVersion &&
                existingReceipt.payloadDigest === baseRecord.payloadDigest;
              if (exact) {
                return {
                  storageKey: existingReceipt.storageKey,
                  clientMutationId: existingReceipt.clientMutationId,
                  scopeKey: existingReceipt.scopeKey,
                  scope: existingReceipt.scope,
                  evaluationId: existingReceipt.evaluationId,
                  expectedVersion: existingReceipt.expectedVersion,
                  payloadDigest: existingReceipt.payloadDigest,
                  status: 'acknowledged' as const,
                  syncState: 'synced' as const,
                  serverVersion: existingReceipt.serverVersion,
                  acknowledgedAt: existingReceipt.acknowledgedAt,
                };
              }
              await this.addToQuarantine(
                transaction,
                'receipts',
                existingReceipt,
                'receipt_divergence',
                'A replay diverged from an authoritative terminal receipt.',
                now,
              );
              receiptMismatch = true;
              return null;
            } catch (error) {
              if (error instanceof EvaluationOfflineError && error.code === 'corrupt_record') {
                await this.ensureReceiptTombstone(transaction, scope, clientMutationId, now);
                await this.moveToQuarantine(
                  transaction,
                  'receipts',
                  existingReceiptRaw,
                  'digest_mismatch',
                  'A terminal receipt failed replay integrity validation.',
                  now,
                );
                corruption = true;
                return null;
              }
              throw error;
            }
          }
          const rawTombstone = await this.database.receiptTombstones.get(baseRecord.storageKey);
          if (rawTombstone) {
            try {
              const tombstone = await this.validateReceiptTombstone(
                rawTombstone,
                scope,
                clientMutationId,
              );
              const terminal = this.acknowledgedFromTombstone(tombstone, {
                ...baseRecord,
              });
              if (terminal) return terminal;
              if (tombstone.reason === 'receipt_authority') receiptMismatch = true;
              else corruption = true;
              return null;
            } catch {
              await this.ensureReceiptTombstone(transaction, scope, clientMutationId, now);
              corruption = true;
              return null;
            }
          }
          const receiptRecovery = await this.database.quarantines
            .where('scopeKey')
            .equals(baseRecord.scopeKey)
            .filter(
              (record) =>
                record.sourceTable === 'receipts' &&
                record.recoveryEnvelope.clientMutationId === clientMutationId,
            )
            .first();
          if (receiptRecovery) {
            corruption = true;
            return null;
          }
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
                existing.storageKey === baseRecord.storageKey
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
          const rawCounter = await this.database.queueCounters.get(baseRecord.queueKey);
          const parsedCounter = rawCounter ? storedQueueCounterSchema.safeParse(rawCounter) : null;
          const rawQueueMutations = allMutations.filter(
            (candidate) => candidate.queueKey === baseRecord.queueKey,
          );
          const queueMutations: StoredEvaluationMutation[] = [];
          for (const candidate of rawQueueMutations) {
            try {
              queueMutations.push(await this.validateMutationRecord(candidate));
            } catch {
              await this.addToQuarantine(
                transaction,
                'mutations',
                candidate,
                'invalid_record',
                'Enqueue found invalid existing queue lineage.',
                now,
              );
              corruption = true;
            }
          }
          if (
            corruption ||
            !(await this.validateQueueLineage(transaction, scope, queueMutations, now))
          ) {
            corruption = true;
            return null;
          }
          const maximumSequence = queueMutations.reduce(
            (maximum, candidate) =>
              Number.isSafeInteger(candidate.queueSequence)
                ? Math.max(maximum, candidate.queueSequence)
                : maximum,
            0,
          );
          if (
            parsedCounter &&
            (!parsedCounter.success ||
              parsedCounter.data.scopeKey !== baseRecord.scopeKey ||
              parsedCounter.data.nextSequence <= maximumSequence ||
              parsedCounter.data.nextSequence >= Number.MAX_SAFE_INTEGER)
          ) {
            await this.addToQuarantine(
              transaction,
              'queueCounters',
              rawCounter,
              'invalid_record',
              'Queue sequence counter failed strict validation.',
              now,
            );
            corruption = true;
            return null;
          }
          if (!rawCounter && maximumSequence > 0) {
            await this.addToQuarantine(
              transaction,
              'queueCounters',
              {
                queueKey: baseRecord.queueKey,
                scopeKey: baseRecord.scopeKey,
                nextSequence: maximumSequence,
                status: 'needs_attention',
              },
              'invalid_record',
              'Queue sequence lineage is missing for existing work.',
              now,
            );
            corruption = true;
            return null;
          }
          const queueSequence = parsedCounter?.success ? parsedCounter.data.nextSequence : 1;
          const record: StoredEvaluationMutation = { ...baseRecord, queueSequence };
          await this.assertByteQuota(transaction, record);
          await this.database.queueCounters.put({
            queueKey: record.queueKey,
            scopeKey: record.scopeKey,
            nextSequence: queueSequence + 1,
          });
          await this.database.mutations.add(record);
          return structuredClone(record);
        },
      );
      if (receiptMismatch)
        throw new EvaluationOfflineError(
          'receipt_mismatch',
          'The client mutation ID is terminally bound to a different payload.',
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
        this.allTables(),
        async (transaction) => {
          let context: StoredSessionContext | null = null;
          const rawContext = await this.database.sessionContexts.get(scopeKey(scope));
          if (rawContext) {
            try {
              context = await this.validateContext(rawContext, scope);
            } catch {
              await this.moveToQuarantine(
                transaction,
                'sessionContexts',
                rawContext,
                'invalid_record',
                'Claim scan found invalid rubric context.',
                now,
              );
              corruptCount += 1;
            }
          }
          const rawRecords = await this.database.mutations
            .where('scopeKey')
            .equals(scopeKey(scope))
            .toArray();
          const records: StoredEvaluationMutation[] = [];
          for (const raw of rawRecords) {
            try {
              const record = await this.validateMutationRecord(raw);
              let receipt: StoredEvaluationReceipt | null = null;
              const rawReceipt = await this.database.receipts.get(record.storageKey);
              if (rawReceipt) {
                try {
                  receipt = await this.validateReceiptRecord(rawReceipt, {
                    scope,
                    clientMutationId: record.clientMutationId,
                  });
                  await this.ensureReceiptTombstone(
                    transaction,
                    scope,
                    record.clientMutationId,
                    now,
                    receipt,
                  );
                } catch {
                  await this.ensureReceiptTombstone(
                    transaction,
                    scope,
                    record.clientMutationId,
                    now,
                  );
                  await this.moveToQuarantine(
                    transaction,
                    'receipts',
                    rawReceipt,
                    'digest_mismatch',
                    'Claim scan found an invalid authoritative receipt.',
                    now,
                  );
                  corruptCount += 1;
                  continue;
                }
              }
              let tombstone: StoredEvaluationReceiptTombstone | null = null;
              const rawTombstone = await this.database.receiptTombstones.get(record.storageKey);
              if (rawTombstone) {
                try {
                  tombstone = await this.validateReceiptTombstone(
                    rawTombstone,
                    scope,
                    record.clientMutationId,
                  );
                } catch {
                  await this.ensureReceiptTombstone(
                    transaction,
                    scope,
                    record.clientMutationId,
                    now,
                  );
                  corruptCount += 1;
                  continue;
                }
              }
              if (receipt) {
                const exact =
                  receipt.scopeKey === record.scopeKey &&
                  receipt.evaluationId === record.evaluationId &&
                  receipt.clientMutationId === record.clientMutationId &&
                  receipt.expectedVersion === record.expectedVersion &&
                  receipt.payloadDigest === record.payloadDigest &&
                  receipt.serverVersion === record.expectedVersion + 1;
                if (!exact) {
                  await this.moveToQuarantine(
                    transaction,
                    'mutations',
                    raw,
                    'receipt_divergence',
                    'Claim scan retained work diverging from its terminal receipt.',
                    now,
                  );
                  corruptCount += 1;
                  continue;
                }
                if (record.status !== 'acknowledged') {
                  await this.database.mutations.put({
                    ...record,
                    status: 'acknowledged',
                    syncState: 'synced',
                    acknowledgedAt: receipt.acknowledgedAt,
                    updatedAt:
                      record.updatedAt < receipt.acknowledgedAt
                        ? receipt.acknowledgedAt
                        : record.updatedAt,
                    claimToken: undefined,
                    leaseUntil: undefined,
                    errorCategory: undefined,
                    lastError: undefined,
                  });
                }
                continue;
              }
              if (tombstone) {
                if (!this.tombstoneMatchesMutation(tombstone, record)) {
                  await this.addToQuarantine(
                    transaction,
                    'mutations',
                    raw,
                    'receipt_divergence',
                    'Claim scan found work fenced by terminal receipt recovery.',
                    now,
                  );
                  corruptCount += 1;
                  continue;
                }
                if (record.status !== 'acknowledged') {
                  await this.database.mutations.put({
                    ...record,
                    status: 'acknowledged',
                    syncState: 'synced',
                    acknowledgedAt: tombstone.acknowledgedAt,
                    updatedAt:
                      record.updatedAt < tombstone.acknowledgedAt!
                        ? tombstone.acknowledgedAt!
                        : record.updatedAt,
                    claimToken: undefined,
                    leaseUntil: undefined,
                    errorCategory: undefined,
                    lastError: undefined,
                  });
                }
                continue;
              }
              if (record.status === 'acknowledged') {
                await this.moveToQuarantine(
                  transaction,
                  'mutations',
                  raw,
                  'terminal_pair_inconsistent',
                  'Claim scan found acknowledged work without a terminal receipt.',
                  now,
                );
                corruptCount += 1;
                continue;
              }
              if (!context) {
                throw new EvaluationOfflineError(
                  'corrupt_record',
                  'Syncable work has no exact rubric context.',
                );
              }
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
          if (!(await this.validateQueueLineage(transaction, scope, records, now))) {
            corruptCount += 1;
          }
          if (corruptCount > 0) return null;
          const ordered = records.sort(
            (left, right) =>
              left.queueSequence - right.queueSequence ||
              left.createdAt.localeCompare(right.createdAt) ||
              left.storageKey.localeCompare(right.storageKey),
          );
          const quarantines = await this.database.quarantines
            .where('scopeKey')
            .equals(scopeKey(scope))
            .toArray();
          const seenQueues = new Set(
            quarantines.flatMap((record) =>
              record.sourceTable === 'mutations' && record.recoveryEnvelope.evaluationId
                ? [evaluationQueueKey(scope, record.recoveryEnvelope.evaluationId)]
                : [],
            ),
          );
          const heads: StoredEvaluationMutation[] = [];
          for (const record of ordered) {
            if (!seenQueues.has(record.queueKey)) {
              seenQueues.add(record.queueKey);
              heads.push(record);
            }
          }
          const blockedEvaluationIds = new Set<string>();
          for (const head of heads) {
            if (head.status !== 'needs_attention') continue;
            blockedEvaluationIds.add(head.evaluationId);
            if (head.conflictServerEvaluationId)
              blockedEvaluationIds.add(head.conflictServerEvaluationId);
          }
          let propagatedBlock = true;
          while (propagatedBlock) {
            propagatedBlock = false;
            for (const record of records) {
              if (
                !blockedEvaluationIds.has(record.evaluationId) &&
                (!record.conflictServerEvaluationId ||
                  !blockedEvaluationIds.has(record.conflictServerEvaluationId))
              )
                continue;
              for (const evaluationId of [record.evaluationId, record.conflictServerEvaluationId]) {
                if (evaluationId && !blockedEvaluationIds.has(evaluationId)) {
                  blockedEvaluationIds.add(evaluationId);
                  propagatedBlock = true;
                }
              }
            }
          }
          const candidate = heads
            .filter(
              (record) =>
                !blockedEvaluationIds.has(record.evaluationId) &&
                ((record.status === 'pending' && record.nextAttemptAt <= now.toISOString()) ||
                  (record.status === 'leased' &&
                    Boolean(record.leaseUntil) &&
                    record.leaseUntil! <= now.toISOString())),
            )
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.queueSequence - right.queueSequence ||
                left.storageKey.localeCompare(right.storageKey),
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
      if (corruptCount > 0)
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
      ['conflict', 'forbidden', 'invalid_input', 'invalid_rubric', 'corrupt_record'].includes(
        input.category,
      ),
    );
  }

  async markNeedsAttention(input: {
    scope: EvaluationStorageScope;
    evaluationId: string;
    clientMutationId: string;
    claimToken: string;
    category: EvaluationMutationFailureCategory;
    message: string;
    conflictServerEvaluationId?: string;
    conflictServerVersion?: number;
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
      conflictServerEvaluationId?: string;
      conflictServerVersion?: number;
      now?: Date;
    },
    forceAttention: boolean,
  ): Promise<StoredEvaluationMutation> {
    const input = this.validateTransitionInput(rawInput);
    if (
      !publicFailureCategorySchema.safeParse(rawInput.category).success ||
      typeof rawInput.message !== 'string' ||
      !rawInput.message ||
      new TextEncoder().encode(rawInput.message).byteLength > 500
    )
      throw new EvaluationOfflineError('invalid_input', 'Invalid bounded failure details.');
    if (
      (rawInput.conflictServerEvaluationId === undefined) !==
        (rawInput.conflictServerVersion === undefined) ||
      (rawInput.conflictServerEvaluationId !== undefined &&
        (!uuid.safeParse(rawInput.conflictServerEvaluationId).success ||
          rawInput.category !== 'conflict' ||
          !Number.isSafeInteger(rawInput.conflictServerVersion) ||
          rawInput.conflictServerVersion! < 1))
    )
      throw new EvaluationOfflineError('invalid_input', 'Invalid conflict server identity.');
    try {
      return await this.database.transaction('rw', this.allTables(), async (transaction) => {
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
          conflictServerEvaluationId: rawInput.conflictServerEvaluationId,
          conflictServerVersion: rawInput.conflictServerVersion,
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
      return await this.database.transaction('rw', this.allTables(), async (transaction) => {
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
          conflictServerEvaluationId: undefined,
          conflictServerVersion: undefined,
        };
        await this.database.mutations.put(updated);
        return structuredClone(updated);
      });
    } catch (error) {
      throw mapStorageError(error, 'write');
    }
  }

  async resolveConflict(input: {
    scope: EvaluationStorageScope;
    clientMutationId: string;
    action: 'keep_local' | 'use_server';
    original: {
      evaluationId: string;
      payloadDigest: string;
      queueSequence: number;
    };
    server: {
      scope: EvaluationStorageScope;
      evaluationId: string;
      version: number;
      draft: EvaluationDraftPayload;
    };
    now?: Date;
  }): Promise<{
    action: 'keep_local' | 'use_server';
    evaluationId: string;
    expectedVersion: number;
    draftDigest: string;
    payloadDigest?: string;
    clientMutationId?: string;
    queueSequence?: number;
  }> {
    const scope = this.parseScope(input.scope);
    const serverScope = this.parseScope(input.server.scope);
    const serverDraft = this.parseDraft(input.server.draft);
    const now = safeDate(input.now ?? new Date());
    if (
      scopeKey(serverScope) !== scopeKey(scope) ||
      !uuid.safeParse(input.original.evaluationId).success ||
      !/^[0-9a-f]{64}$/.test(input.original.payloadDigest) ||
      !Number.isSafeInteger(input.original.queueSequence) ||
      input.original.queueSequence < 1 ||
      !uuid.safeParse(input.clientMutationId).success ||
      !uuid.safeParse(input.server.evaluationId).success ||
      !Number.isSafeInteger(input.server.version) ||
      input.server.version < 1 ||
      input.server.version >= 2_147_483_647 ||
      !['keep_local', 'use_server'].includes(input.action)
    )
      throw new EvaluationOfflineError('invalid_input', 'Invalid conflict resolution context.');

    const serverSnapshotDigest = await digestValue({
      scope: serverScope,
      evaluationId: input.server.evaluationId,
      version: input.server.version,
      draft: serverDraft,
    });

    try {
      return await this.database.transaction('rw', this.allTables(), async (transaction) => {
        const storageKey = `${scopeKey(scope)}|${input.clientMutationId}`;
        const rawHead = await this.database.mutations.get(storageKey);
        if (!rawHead) {
          const rawTombstone = await this.database.receiptTombstones.get(storageKey);
          if (!rawTombstone)
            throw new EvaluationOfflineError(
              'mutation_not_found',
              'Evaluation mutation not found.',
            );
          const tombstone = await this.validateReceiptTombstone(
            rawTombstone,
            scope,
            input.clientMutationId,
          );
          const expectedReason =
            input.action === 'keep_local' ? 'conflict_keep_local' : 'conflict_use_server';
          if (tombstone.reason !== expectedReason)
            throw new EvaluationOfflineError(
              'invalid_transition',
              'Conflict resolution action does not match its durable terminal record.',
            );
          if (
            tombstone.resolutionOriginalEvaluationId !== input.original.evaluationId ||
            tombstone.resolutionOriginalPayloadDigest !== input.original.payloadDigest ||
            tombstone.resolutionOriginalQueueSequence !== input.original.queueSequence ||
            tombstone.resolutionServerEvaluationId !== input.server.evaluationId ||
            tombstone.resolutionServerVersion !== input.server.version ||
            tombstone.resolutionServerSnapshotDigest !== serverSnapshotDigest ||
            !tombstone.resolutionResultDraftDigest ||
            !tombstone.resolutionResultPayloadDigest ||
            !tombstone.resolutionResultMarker
          )
            throw new EvaluationOfflineError(
              'invalid_transition',
              'Conflict resolution does not match its durable server snapshot and lineage.',
            );
          const context = await this.requireContext(transaction, scope);
          this.assertDraftMatchesContext(serverDraft, context);
          if (tombstone.resolutionResultMarker === 'keep_local_rebased') {
            const successorMutationId = tombstone.resolutionResultMutationId!;
            const successorStorageKey = `${scopeKey(scope)}|${successorMutationId}`;
            const rawSuccessor = await this.database.mutations.get(successorStorageKey);
            let successorProven = false;
            if (rawSuccessor) {
              const successor = await this.validateMutationRecord(rawSuccessor);
              this.assertDraftMatchesContext(successor.draft, context);
              const successorDraftDigest = await Dexie.waitFor(digestValue(successor.draft));
              successorProven =
                successor.evaluationId === tombstone.resolutionServerEvaluationId &&
                successor.expectedVersion === tombstone.resolutionServerVersion &&
                successor.queueSequence === tombstone.resolutionResultQueueSequence &&
                successor.payloadDigest === tombstone.resolutionResultPayloadDigest &&
                successorDraftDigest === tombstone.resolutionResultDraftDigest;
              if (successorProven) {
                await this.validateQueueForStrictAppend(
                  transaction,
                  scope,
                  successor.queueKey,
                  now,
                );
              }
            } else {
              const rawReceipt = await this.database.receipts.get(successorStorageKey);
              if (rawReceipt) {
                const receipt = await this.validateReceiptRecord(rawReceipt, {
                  scope,
                  clientMutationId: successorMutationId,
                });
                successorProven =
                  receipt.evaluationId === tombstone.resolutionServerEvaluationId &&
                  receipt.expectedVersion === tombstone.resolutionServerVersion &&
                  receipt.payloadDigest === tombstone.resolutionResultPayloadDigest;
              } else {
                const rawSuccessorTombstone =
                  await this.database.receiptTombstones.get(successorStorageKey);
                if (rawSuccessorTombstone) {
                  const successorTombstone = await this.validateReceiptTombstone(
                    rawSuccessorTombstone,
                    scope,
                    successorMutationId,
                  );
                  successorProven =
                    successorTombstone.reason === 'receipt_authority' &&
                    successorTombstone.evaluationId === tombstone.resolutionServerEvaluationId &&
                    successorTombstone.expectedVersion === tombstone.resolutionServerVersion &&
                    successorTombstone.payloadDigest === tombstone.resolutionResultPayloadDigest &&
                    successorTombstone.serverVersion === tombstone.resolutionServerVersion! + 1;
                }
              }
            }
            if (!successorProven)
              throw new EvaluationOfflineError(
                'corrupt_record',
                'Conflict resolution successor lineage is missing or divergent.',
              );
            await this.validateQueueForStrictAppend(
              transaction,
              scope,
              evaluationQueueKey(scope, tombstone.resolutionServerEvaluationId),
              now,
            );
          } else {
            const rawDraft = await this.database.drafts.get(scopeKey(scope));
            const resolvedDraft = rawDraft ? await this.validateDraftRecord(rawDraft, scope) : null;
            if (
              !resolvedDraft ||
              resolvedDraft.evaluationId !== tombstone.resolutionServerEvaluationId ||
              resolvedDraft.expectedVersion !== tombstone.resolutionServerVersion ||
              resolvedDraft.payloadDigest !== tombstone.resolutionResultPayloadDigest ||
              (await Dexie.waitFor(digestValue(resolvedDraft.draft))) !==
                tombstone.resolutionResultDraftDigest
            )
              throw new EvaluationOfflineError(
                'corrupt_record',
                'Conflict resolution server draft lineage is missing or divergent.',
              );
          }
          return {
            action: input.action,
            evaluationId: tombstone.resolutionServerEvaluationId,
            expectedVersion: tombstone.resolutionServerVersion,
            draftDigest: tombstone.resolutionResultDraftDigest,
            ...(tombstone.resolutionResultMutationId
              ? { clientMutationId: tombstone.resolutionResultMutationId }
              : {}),
            ...(tombstone.resolutionResultQueueSequence
              ? { queueSequence: tombstone.resolutionResultQueueSequence }
              : {}),
            ...(tombstone.resolutionResultPayloadDigest
              ? { payloadDigest: tombstone.resolutionResultPayloadDigest }
              : {}),
          };
        }
        const head = await this.validateMutationRecord(rawHead);
        if (
          head.scopeKey !== scopeKey(scope) ||
          head.evaluationId !== input.original.evaluationId ||
          head.payloadDigest !== input.original.payloadDigest ||
          head.queueSequence !== input.original.queueSequence ||
          head.status !== 'needs_attention' ||
          head.errorCategory !== 'conflict' ||
          head.conflictServerEvaluationId !== input.server.evaluationId ||
          head.conflictServerVersion !== input.server.version
        )
          throw new EvaluationOfflineError(
            'invalid_transition',
            'Only the exact conflicted queue head can be reconciled.',
          );
        const context = await this.requireContext(transaction, scope);
        this.assertDraftMatchesContext(serverDraft, context);
        const rawDraft = await this.database.drafts.get(scopeKey(scope));
        const storedDraft = rawDraft ? await this.validateDraftRecord(rawDraft, scope) : null;
        const allScopeRowsRaw = await this.database.mutations
          .where('scopeKey')
          .equals(scopeKey(scope))
          .toArray();
        const allScopeRows: StoredEvaluationMutation[] = [];
        for (const raw of allScopeRowsRaw)
          allScopeRows.push(await this.validateMutationRecord(raw));
        const relatedEvaluationIds = new Set([
          head.evaluationId,
          input.server.evaluationId,
          ...(storedDraft?.evaluationId ? [storedDraft.evaluationId] : []),
        ]);
        let addedRelatedId = true;
        while (addedRelatedId) {
          addedRelatedId = false;
          for (const row of allScopeRows) {
            if (
              !relatedEvaluationIds.has(row.evaluationId) &&
              (!row.conflictServerEvaluationId ||
                !relatedEvaluationIds.has(row.conflictServerEvaluationId))
            )
              continue;
            for (const evaluationId of [row.evaluationId, row.conflictServerEvaluationId]) {
              if (evaluationId && !relatedEvaluationIds.has(evaluationId)) {
                relatedEvaluationIds.add(evaluationId);
                addedRelatedId = true;
              }
            }
          }
        }
        const queueRows = allScopeRows.filter(
          (row) => row.status !== 'acknowledged' && relatedEvaluationIds.has(row.evaluationId),
        );
        const originalQueueRows = queueRows
          .filter((row) => row.queueKey === head.queueKey)
          .sort((left, right) => left.queueSequence - right.queueSequence);
        if (
          originalQueueRows[0]?.storageKey !== head.storageKey ||
          queueRows.some((row) => row.status === 'leased')
        )
          throw new EvaluationOfflineError(
            'invalid_transition',
            'Conflict resolution lost the durable FIFO head.',
          );

        const latestMutation =
          [...queueRows]
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.queueSequence - right.queueSequence ||
                left.storageKey.localeCompare(right.storageKey),
            )
            .at(-1) ?? head;
        const localDraft =
          storedDraft?.evaluationId && relatedEvaluationIds.has(storedDraft.evaluationId)
            ? storedDraft.draft
            : latestMutation.draft;
        this.assertDraftMatchesContext(localDraft, context);

        const chosenDraft = input.action === 'keep_local' ? localDraft : serverDraft;
        const timestamp = now.toISOString();
        const resultDraftDigest = await Dexie.waitFor(digestValue(chosenDraft));
        const draftRecord: StoredEvaluationDraft = {
          scopeKey: scopeKey(scope),
          scope,
          evaluationId: input.server.evaluationId,
          expectedVersion: input.server.version,
          draft: chosenDraft,
          payloadDigest: await Dexie.waitFor(
            digestValue(
              evaluationPayload(
                scope,
                input.server.evaluationId,
                input.server.version,
                chosenDraft,
              ),
            ),
          ),
          syncState: input.action === 'keep_local' ? 'saved_device' : 'synced',
          updatedAt: timestamp,
          expiresAt: addMilliseconds(now, DRAFT_TTL_MS),
        };
        await this.assertByteQuota(transaction, draftRecord);
        await this.database.drafts.put(draftRecord);

        let rebased: StoredEvaluationMutation | undefined;
        if (input.action === 'keep_local') {
          const newQueueKey = evaluationQueueKey(scope, input.server.evaluationId);
          const queueSequence = await this.validateQueueForStrictAppend(
            transaction,
            scope,
            newQueueKey,
            now,
          );
          const clientMutationId = crypto.randomUUID();
          const payloadDigest = await Dexie.waitFor(
            digestValue(
              evaluationPayload(scope, input.server.evaluationId, input.server.version, localDraft),
            ),
          );
          rebased = {
            storageKey: `${scopeKey(scope)}|${clientMutationId}`,
            clientMutationId,
            scopeKey: scopeKey(scope),
            queueKey: newQueueKey,
            queueSequence,
            scope,
            evaluationId: input.server.evaluationId,
            expectedVersion: input.server.version,
            draft: localDraft,
            payloadDigest,
            status: 'pending',
            syncState: 'saved_device',
            createdAt: timestamp,
            updatedAt: timestamp,
            nextAttemptAt: timestamp,
            attemptCount: 0,
          };
          await this.assertByteQuota(transaction, rebased);
          await this.database.queueCounters.put({
            queueKey: newQueueKey,
            scopeKey: scopeKey(scope),
            nextSequence: queueSequence + 1,
          });
          await this.database.mutations.add(rebased);
        }

        for (const row of queueRows) {
          await this.database.mutations.delete(row.storageKey);
          await this.ensureConflictResolutionTombstone(
            transaction,
            scope,
            row.clientMutationId,
            row.storageKey === head.storageKey
              ? input.action === 'keep_local'
                ? 'conflict_keep_local'
                : 'conflict_use_server'
              : 'conflict_dependent',
            now,
            row.storageKey === head.storageKey
              ? {
                  resolutionOriginalEvaluationId: head.evaluationId,
                  resolutionOriginalPayloadDigest: head.payloadDigest,
                  resolutionOriginalQueueSequence: head.queueSequence,
                  resolutionServerEvaluationId: input.server.evaluationId,
                  resolutionServerVersion: input.server.version,
                  resolutionServerSnapshotDigest: serverSnapshotDigest,
                  resolutionResultDraftDigest: resultDraftDigest,
                  resolutionResultPayloadDigest: draftRecord.payloadDigest,
                  resolutionResultMarker:
                    input.action === 'keep_local' ? 'keep_local_rebased' : 'use_server_discarded',
                  ...(rebased
                    ? {
                        resolutionResultMutationId: rebased.clientMutationId,
                        resolutionResultQueueSequence: rebased.queueSequence,
                      }
                    : {}),
                }
              : undefined,
          );
        }
        return {
          action: input.action,
          evaluationId: input.server.evaluationId,
          expectedVersion: input.server.version,
          draftDigest: resultDraftDigest,
          payloadDigest: draftRecord.payloadDigest,
          ...(rebased
            ? {
                clientMutationId: rebased.clientMutationId,
                queueSequence: rebased.queueSequence,
              }
            : {}),
        };
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
    let corruption = false;
    try {
      const result = await this.database.transaction(
        'rw',
        this.allTables(),
        async (transaction) => {
          const storageKey = `${scopeKey(transition.scope)}|${rawInput.clientMutationId}`;
          const existingRaw = await this.database.receipts.get(storageKey);
          if (existingRaw) {
            let existing: StoredEvaluationReceipt;
            try {
              existing = await this.validateReceiptRecord(existingRaw, {
                scope: transition.scope,
                clientMutationId: rawInput.clientMutationId,
              });
            } catch {
              await this.ensureReceiptTombstone(
                transaction,
                transition.scope,
                rawInput.clientMutationId,
                transition.now,
              );
              await this.moveToQuarantine(
                transaction,
                'receipts',
                existingRaw,
                'digest_mismatch',
                'Acknowledgment replay found an invalid terminal receipt.',
                transition.now,
              );
              corruption = true;
              return null;
            }
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
            throw new EvaluationOfflineError(
              'mutation_not_found',
              'Evaluation mutation not found.',
            );
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
          await this.ensureReceiptTombstone(
            transaction,
            transition.scope,
            mutation.clientMutationId,
            transition.now,
            receipt,
          );
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
        },
      );
      if (corruption || !result) {
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Invalid terminal receipt was retained in quarantine.',
        );
      }
      return result;
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
        this.allTables(),
        async (transaction) => {
          const rawRecords = await this.database.mutations
            .where('scopeKey')
            .equals(scopeKey(scope))
            .toArray();
          rawRecords.sort(
            (left, right) =>
              Number((left as StoredEvaluationMutation).queueSequence) -
                Number((right as StoredEvaluationMutation).queueSequence) ||
              String(left.createdAt).localeCompare(String(right.createdAt)) ||
              String(left.storageKey).localeCompare(String(right.storageKey)),
          );
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
              if (context) {
                this.assertDraftMatchesContext(record.draft, context);
              } else if (record.status === 'acknowledged') {
                const rawReceipt = await this.database.receipts.get(record.storageKey);
                const rawTombstone = await this.database.receiptTombstones.get(record.storageKey);
                const receipt = rawReceipt
                  ? await this.validateReceiptRecord(rawReceipt, {
                      scope,
                      clientMutationId: record.clientMutationId,
                    })
                  : null;
                const tombstone = rawTombstone
                  ? await this.validateReceiptTombstone(
                      rawTombstone,
                      scope,
                      record.clientMutationId,
                    )
                  : null;
                const receiptMatches =
                  receipt !== null &&
                  receipt.evaluationId === record.evaluationId &&
                  receipt.expectedVersion === record.expectedVersion &&
                  receipt.payloadDigest === record.payloadDigest;
                if (
                  !receiptMatches &&
                  (!tombstone || !this.tombstoneMatchesMutation(tombstone, record))
                ) {
                  throw new EvaluationOfflineError(
                    'corrupt_record',
                    'Terminal work has no exact receipt authority.',
                  );
                }
              } else if (record.status !== 'needs_attention') {
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

  async listQuarantines(scopeInput: EvaluationStorageScope): Promise<StoredEvaluationQuarantine[]> {
    const scope = this.parseScope(scopeInput);
    try {
      return await this.database.transaction('rw', this.allTables(), async (transaction) => {
        const table = transaction.table<unknown, IndexableType>('quarantines');
        const physicalKeys = await table.where('scopeKey').equals(scopeKey(scope)).primaryKeys();
        const rawRecords = await table.bulkGet(physicalKeys);
        const readable: StoredEvaluationQuarantine[] = [];
        for (const [index, raw] of rawRecords.entries()) {
          if (raw === undefined) continue;
          const parsed = storedQuarantineSchema.safeParse(raw);
          if (parsed.success) {
            readable.push(structuredClone(parsed.data));
            continue;
          }
          const physicalKey = physicalKeys[index]!;
          const replacementKey = await this.repairedQuarantineKey(transaction, scope, physicalKey);
          const replacement = this.makeQuarantine(
            'mutations',
            { scope, scopeKey: scopeKey(scope) },
            'invalid_record',
            'Stored quarantine metadata was reduced to a safe minimal record.',
            new Date(),
          );
          const deterministicReplacement = storedQuarantineSchema.parse({
            ...replacement,
            quarantineKey: replacementKey,
          });
          await table.delete(physicalKey);
          await this.assertByteQuota(transaction, deterministicReplacement);
          await table.put(deterministicReplacement, replacementKey);
          readable.push(structuredClone(deterministicReplacement));
        }
        return readable.sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.quarantineKey.localeCompare(right.quarantineKey),
        );
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
        this.allTables(),
        async (transaction) => {
          const storageKey = `${scopeKey(scope)}|${clientMutationId}`;
          const rawTombstone = await this.database.receiptTombstones.get(storageKey);
          let tombstone: StoredEvaluationReceiptTombstone | null = null;
          if (rawTombstone) {
            try {
              tombstone = await this.validateReceiptTombstone(
                rawTombstone,
                scope,
                clientMutationId,
              );
            } catch {
              tombstone = await this.ensureReceiptTombstone(
                transaction,
                scope,
                clientMutationId,
                new Date(),
              );
              corrupt = true;
            }
          }
          const raw = await this.database.receipts.get(storageKey);
          if (!raw) {
            if (tombstone?.reason === 'corrupt_receipt') corrupt = true;
            return null;
          }
          try {
            const receipt = await this.validateReceiptRecord(raw, { scope, clientMutationId });
            await this.ensureReceiptTombstone(
              transaction,
              scope,
              clientMutationId,
              new Date(),
              receipt,
            );
            return structuredClone(receipt);
          } catch {
            await this.ensureReceiptTombstone(transaction, scope, clientMutationId, new Date());
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
    const key = scopeKey(scope);
    const now = new Date().toISOString();
    let corruption = false;
    try {
      const state = await this.database.transaction('rw', this.allTables(), async (transaction) => {
        const rawQuarantines = await this.database.quarantines
          .where('scopeKey')
          .equals(key)
          .toArray();
        for (const raw of rawQuarantines) {
          if (!storedQuarantineSchema.safeParse(raw).success) {
            corruption = true;
          }
        }

        let context: StoredSessionContext | null = null;
        const rawContext = await this.database.sessionContexts.get(key);
        if (rawContext) {
          try {
            context = await this.validateContext(rawContext, scope);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'sessionContexts',
              rawContext,
              'invalid_record',
              'Sync-state snapshot found invalid rubric context.',
              new Date(),
            );
            corruption = true;
          }
        }

        let draftRecord: StoredEvaluationDraft | null = null;
        const rawDraft = await this.database.drafts.get(key);
        if (rawDraft) {
          try {
            draftRecord = await this.validateDraftRecord(rawDraft, scope);
            if (!context) throw new Error('Draft has no exact rubric context.');
            this.assertDraftMatchesContext(draftRecord.draft, context);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'drafts',
              rawDraft,
              'digest_mismatch',
              'Sync-state snapshot found invalid draft data.',
              new Date(),
            );
            draftRecord = null;
            corruption = true;
          }
        }

        const receipts = new Map<string, StoredEvaluationReceipt>();
        const rawReceipts = await this.database.receipts
          .filter(
            (record) =>
              typeof record.storageKey === 'string' && record.storageKey.startsWith(`${key}|`),
          )
          .toArray();
        for (const raw of rawReceipts) {
          try {
            const clientMutationId = raw.storageKey.slice(`${key}|`.length);
            if (!uuid.safeParse(clientMutationId).success) throw new Error('Invalid physical key.');
            const receipt = await this.validateReceiptRecord(raw, { scope, clientMutationId });
            receipts.set(receipt.storageKey, receipt);
            await this.ensureReceiptTombstone(
              transaction,
              scope,
              clientMutationId,
              new Date(),
              receipt,
            );
          } catch {
            const clientMutationId = raw.storageKey.slice(`${key}|`.length);
            if (uuid.safeParse(clientMutationId).success) {
              await this.ensureReceiptTombstone(transaction, scope, clientMutationId, new Date());
            }
            await this.moveToQuarantine(
              transaction,
              'receipts',
              raw,
              'digest_mismatch',
              'Sync-state snapshot found an invalid terminal receipt.',
              new Date(),
            );
            const relatedMutation = await this.database.mutations.get(raw.storageKey);
            if (relatedMutation) {
              await this.addToQuarantine(
                transaction,
                'mutations',
                relatedMutation,
                'receipt_divergence',
                'A mutation remains terminally fenced by a corrupt receipt.',
                new Date(),
              );
            }
            corruption = true;
          }
        }

        const tombstones = new Map<string, StoredEvaluationReceiptTombstone>();
        const rawTombstones = await this.physicallyScopedTombstones(transaction, scope);
        for (const { physicalKey, clientMutationId, raw } of rawTombstones) {
          try {
            const tombstone = await this.validateReceiptTombstone(raw, scope, clientMutationId);
            tombstones.set(physicalKey, tombstone);
            if (tombstone.reason === 'corrupt_receipt') corruption = true;
          } catch {
            if (uuid.safeParse(clientMutationId).success) {
              await this.ensureReceiptTombstone(transaction, scope, clientMutationId, new Date());
            } else {
              await this.moveToQuarantine(
                transaction,
                'receiptTombstones',
                raw,
                'digest_mismatch',
                'Sync-state snapshot found an invalid terminal tombstone.',
                new Date(),
                { physicalKey, scope },
              );
            }
            corruption = true;
          }
        }

        const mutations: StoredEvaluationMutation[] = [];
        const rawMutations = await this.database.mutations.where('scopeKey').equals(key).toArray();
        for (const raw of rawMutations) {
          try {
            let mutation = await this.validateMutationRecord(raw);
            const receipt = receipts.get(mutation.storageKey);
            const tombstone = tombstones.get(mutation.storageKey);
            if (receipt) {
              const exact =
                receipt.evaluationId === mutation.evaluationId &&
                receipt.clientMutationId === mutation.clientMutationId &&
                receipt.expectedVersion === mutation.expectedVersion &&
                receipt.payloadDigest === mutation.payloadDigest &&
                receipt.serverVersion === mutation.expectedVersion + 1;
              if (!exact) throw new Error('Mutation diverges from terminal receipt.');
              if (mutation.status !== 'acknowledged') {
                mutation = {
                  ...mutation,
                  status: 'acknowledged',
                  syncState: 'synced',
                  acknowledgedAt: receipt.acknowledgedAt,
                  updatedAt:
                    mutation.updatedAt < receipt.acknowledgedAt
                      ? receipt.acknowledgedAt
                      : mutation.updatedAt,
                  claimToken: undefined,
                  leaseUntil: undefined,
                  errorCategory: undefined,
                  lastError: undefined,
                };
                await this.database.mutations.put(mutation);
              }
            } else if (tombstone) {
              if (!this.tombstoneMatchesMutation(tombstone, mutation)) {
                throw new Error('Mutation is fenced by terminal receipt recovery.');
              }
              if (mutation.status !== 'acknowledged') {
                mutation = {
                  ...mutation,
                  status: 'acknowledged',
                  syncState: 'synced',
                  acknowledgedAt: tombstone.acknowledgedAt,
                  updatedAt:
                    mutation.updatedAt < tombstone.acknowledgedAt!
                      ? tombstone.acknowledgedAt!
                      : mutation.updatedAt,
                  claimToken: undefined,
                  leaseUntil: undefined,
                  errorCategory: undefined,
                  lastError: undefined,
                };
                await this.database.mutations.put(mutation);
              }
            } else if (mutation.status === 'acknowledged') {
              throw new Error('Acknowledged mutation has no terminal receipt.');
            } else {
              if (!context) throw new Error('Syncable mutation has no rubric context.');
              this.assertDraftMatchesContext(mutation.draft, context);
            }
            mutations.push(mutation);
          } catch {
            await this.moveToQuarantine(
              transaction,
              'mutations',
              raw,
              'receipt_divergence',
              'Sync-state snapshot found invalid or terminally divergent work.',
              new Date(),
            );
            corruption = true;
          }
        }

        if (!(await this.validateQueueLineage(transaction, scope, mutations, new Date()))) {
          corruption = true;
        }

        const rawCounters = await this.database.queueCounters
          .where('scopeKey')
          .equals(key)
          .toArray();
        for (const raw of rawCounters) {
          const parsed = storedQueueCounterSchema.safeParse(raw);
          if (!parsed.success || parsed.data.scopeKey !== key) {
            await this.moveToQuarantine(
              transaction,
              'queueCounters',
              raw,
              'invalid_record',
              'Sync-state snapshot found an invalid FIFO counter.',
              new Date(),
            );
            corruption = true;
          }
        }

        const quarantineCount = await this.database.quarantines
          .where('scopeKey')
          .equals(key)
          .count();
        if (corruption) return 'needs_attention' as const;
        if (
          quarantineCount > 0 ||
          mutations.some((mutation) => mutation.status === 'needs_attention')
        ) {
          return 'needs_attention' as const;
        }
        if (
          mutations.some(
            (mutation) =>
              mutation.status === 'leased' &&
              Boolean(mutation.leaseUntil) &&
              mutation.leaseUntil! > now,
          )
        ) {
          return 'syncing' as const;
        }
        if (
          mutations.some(
            (mutation) =>
              mutation.status === 'pending' ||
              (mutation.status === 'leased' &&
                (!mutation.leaseUntil || mutation.leaseUntil <= now)),
          ) ||
          draftRecord?.syncState === 'saved_device'
        ) {
          return 'saved_device' as const;
        }
        if (
          receipts.size > 0 ||
          [...tombstones.values()].some((tombstone) => tombstone.reason === 'receipt_authority') ||
          mutations.some((mutation) => mutation.status === 'acknowledged') ||
          draftRecord?.syncState === 'synced'
        ) {
          return 'synced' as const;
        }
        return null;
      });
      if (corruption) {
        throw new EvaluationOfflineError(
          'corrupt_record',
          'Sync-state validation retained corrupt work for recovery.',
        );
      }
      return state;
    } catch (error) {
      throw mapStorageError(error, 'read');
    }
  }

  async clearAcknowledged(scopeInput: EvaluationStorageScope): Promise<number> {
    const scope = this.parseScope(scopeInput);
    try {
      const result = await this.database.transaction(
        'rw',
        this.allTables(),
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
                const receipt = rawReceipt
                  ? await this.validateReceiptRecord(rawReceipt, {
                      scope,
                      clientMutationId: record.clientMutationId,
                    })
                  : null;
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
      return await this.database.transaction('rw', this.allTables(), async (transaction) => {
        const rawMutations = await this.database.mutations.where('scopeKey').equals(key).toArray();
        const rawReceipts = await this.database.receipts
          .filter(
            (record) =>
              typeof record.storageKey === 'string' && record.storageKey.startsWith(`${key}|`),
          )
          .toArray();
        const rawTombstones = await this.physicallyScopedTombstones(transaction, scope);
        const rawDraft = await this.database.drafts.get(key);
        const rawContext = await this.database.sessionContexts.get(key);
        const rawCounters = await this.database.queueCounters
          .where('scopeKey')
          .equals(key)
          .toArray();
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
            const clientMutationId = raw.storageKey.slice(`${key}|`.length);
            const receipt = await this.validateReceiptRecord(raw, { scope, clientMutationId });
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
        const tombstoneKeys: string[] = [];
        let terminalFencesRetained = 0;
        for (const { physicalKey, clientMutationId, raw } of rawTombstones) {
          try {
            const tombstone = await this.validateReceiptTombstone(raw, scope, clientMutationId);
            if (tombstone.reason === 'receipt_authority') tombstoneKeys.push(physicalKey);
            else terminalFencesRetained += 1;
          } catch {
            if (uuid.safeParse(clientMutationId).success) {
              await this.ensureReceiptTombstone(transaction, scope, clientMutationId, new Date());
              terminalFencesRetained += 1;
            } else {
              await this.moveToQuarantine(
                transaction,
                'receiptTombstones',
                raw,
                'digest_mismatch',
                'Teardown retained an invalid terminal tombstone for review.',
                new Date(),
                { physicalKey, scope },
              );
            }
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
        const counterKeys: string[] = [];
        for (const raw of rawCounters) {
          const parsed = storedQueueCounterSchema.safeParse(raw);
          if (!parsed.success || parsed.data.scopeKey !== key) {
            await this.moveToQuarantine(
              transaction,
              'queueCounters',
              raw,
              'invalid_record',
              'Teardown retained an invalid FIFO counter for review.',
              new Date(),
            );
            newlyQuarantined += 1;
          } else {
            counterKeys.push(parsed.data.queueKey);
          }
        }
        const recoveriesRetained =
          mutations.filter((record) => record.status !== 'acknowledged').length +
          existingQuarantines.length +
          newlyQuarantined;
        const retained = Math.max(recoveriesRetained, terminalFencesRetained);
        if (retained > 0) return { cleared: false, retainedUnacknowledged: retained };
        await this.database.mutations.bulkDelete(mutations.map((record) => record.storageKey));
        await this.database.drafts.delete(key);
        await this.database.sessionContexts.delete(key);
        await this.database.receipts.bulkDelete(rawReceipts.map((receipt) => receipt.storageKey));
        await this.database.receiptTombstones.bulkDelete(tombstoneKeys);
        await this.database.queueCounters.bulkDelete(counterKeys);
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
      return await this.database.transaction('rw', this.allTables(), async (transaction) => {
        const rawMutations = await this.database.mutations.where('scopeKey').equals(key).toArray();
        const rawReceipts = await this.database.receipts
          .filter(
            (record) =>
              typeof record.storageKey === 'string' && record.storageKey.startsWith(`${key}|`),
          )
          .toArray();
        const rawDraft = await this.database.drafts.get(key);
        const rawContext = await this.database.sessionContexts.get(key);
        let corrupt = false;
        const receipts: StoredEvaluationReceipt[] = [];
        for (const raw of rawReceipts) {
          try {
            const clientMutationId = raw.storageKey.slice(`${key}|`.length);
            receipts.push(await this.validateReceiptRecord(raw, { scope, clientMutationId }));
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
            if (sourceTable === 'receipts') return true;
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
      await this.database.transaction('rw', this.allTables(), async (transaction) => {
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
          if (item.payloadDigest !== undefined && item.payloadDigest !== digest) {
            await this.addToQuarantine(
              transaction,
              'drafts',
              raw,
              'digest_mismatch',
              'Shared legacy draft digest does not match its payload.',
              new Date(),
            );
            quarantined += 1;
            continue;
          }
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

        const consumedReceipts = new Set<unknown>();
        for (const raw of matching.get('mutations') ?? []) {
          const item = raw as Record<string, unknown>;
          const parsedScope = evaluationScopeSchema.safeParse(item.scope);
          const parsedDraft = evaluationDraftSchema.safeParse(item.draft);
          if (
            !parsedScope.success ||
            !parsedDraft.success ||
            !uuid.safeParse(item.clientMutationId).success ||
            !uuid.safeParse(item.evaluationId).success ||
            !Number.isSafeInteger(item.expectedVersion) ||
            Number(item.expectedVersion) < 0
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
          if (
            (await this.database.mutations.get(storageKey)) ||
            (await this.database.receipts.get(storageKey))
          ) {
            continue;
          }
          const operationNow = new Date();
          const now = operationNow.toISOString();
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
          if (item.payloadDigest !== undefined && item.payloadDigest !== payloadDigest) {
            await this.addToQuarantine(
              transaction,
              'mutations',
              raw,
              'digest_mismatch',
              'Shared legacy mutation digest does not match its payload.',
              new Date(),
            );
            quarantined += 1;
            continue;
          }
          const joinedReceipts = (matching.get('receipts') ?? []).filter((candidate) => {
            const receiptItem =
              candidate && typeof candidate === 'object'
                ? (candidate as Record<string, unknown>)
                : {};
            return (
              receiptItem.storageKey === storageKey ||
              receiptItem.clientMutationId === item.clientMutationId
            );
          });
          const isTerminalPair = item.status === 'acknowledged' || joinedReceipts.length > 0;
          if (isTerminalPair) {
            for (const receipt of joinedReceipts) consumedReceipts.add(receipt);
            const receiptRaw = joinedReceipts.length === 1 ? joinedReceipts[0] : null;
            const receiptItem =
              receiptRaw && typeof receiptRaw === 'object'
                ? (receiptRaw as Record<string, unknown>)
                : null;
            const parsedReceiptScope = evaluationScopeSchema.safeParse(receiptItem?.scope);
            const optionalScopeMatches =
              receiptItem?.scope === undefined ||
              (parsedReceiptScope.success && scopeKey(parsedReceiptScope.data) === fullKey);
            const optionalEvaluationMatches =
              receiptItem?.evaluationId === undefined ||
              receiptItem.evaluationId === item.evaluationId;
            const optionalExpectedMatches =
              receiptItem?.expectedVersion === undefined ||
              receiptItem.expectedVersion === item.expectedVersion;
            const optionalPayloadMatches =
              receiptItem?.payloadDigest === undefined ||
              receiptItem.payloadDigest === payloadDigest;
            const acknowledgedAt = receiptItem?.acknowledgedAt;
            const pairShapeMatches =
              item.status === 'acknowledged' &&
              receiptItem !== null &&
              receiptItem.storageKey === storageKey &&
              receiptItem.clientMutationId === item.clientMutationId &&
              optionalScopeMatches &&
              optionalEvaluationMatches &&
              optionalExpectedMatches &&
              optionalPayloadMatches &&
              receiptItem.serverVersion === Number(item.expectedVersion) + 1 &&
              typeof acknowledgedAt === 'string' &&
              acknowledgedAt === item.acknowledgedAt;
            const claimToken = uuid.safeParse(receiptItem?.claimToken).success
              ? (receiptItem!.claimToken as string)
              : receiptItem?.claimToken === undefined
                ? crypto.randomUUID()
                : null;
            let synthesizedReceipt: StoredEvaluationReceipt | null = null;
            if (pairShapeMatches && claimToken) {
              const withoutDigest: Omit<StoredEvaluationReceipt, 'receiptDigest'> = {
                storageKey,
                clientMutationId: item.clientMutationId as string,
                scopeKey: fullKey,
                scope: parsedScope.data,
                evaluationId: item.evaluationId as string,
                expectedVersion: item.expectedVersion as number,
                payloadDigest,
                claimToken,
                serverVersion: receiptItem!.serverVersion as number,
                acknowledgedAt: acknowledgedAt as string,
                expiresAt: receiptItem!.expiresAt as string,
              };
              const receiptDigest = await Dexie.waitFor(digestValue(receiptPayload(withoutDigest)));
              if (
                receiptItem!.receiptDigest === undefined ||
                receiptItem!.receiptDigest === receiptDigest
              ) {
                const parsedReceipt = storedReceiptSchema.safeParse({
                  ...withoutDigest,
                  receiptDigest,
                });
                if (parsedReceipt.success) synthesizedReceipt = parsedReceipt.data;
              }
            }
            if (!synthesizedReceipt) {
              await this.addToQuarantine(
                transaction,
                'mutations',
                raw,
                'terminal_pair_inconsistent',
                'Shared terminal mutation and receipt are not jointly consistent.',
                operationNow,
              );
              quarantined += 1;
              for (const inconsistentReceipt of joinedReceipts) {
                await this.addToQuarantine(
                  transaction,
                  'receipts',
                  inconsistentReceipt,
                  'terminal_pair_inconsistent',
                  'Shared terminal receipt and mutation are not jointly consistent.',
                  operationNow,
                );
                quarantined += 1;
              }
              continue;
            }

            const queueKey = evaluationQueueKey(parsedScope.data, item.evaluationId as string);
            const rawCounter = await this.database.queueCounters.get(queueKey);
            const parsedCounter = rawCounter
              ? storedQueueCounterSchema.safeParse(rawCounter)
              : null;
            if (
              parsedCounter &&
              (!parsedCounter.success ||
                parsedCounter.data.queueKey !== queueKey ||
                parsedCounter.data.scopeKey !== fullKey)
            ) {
              await this.moveToQuarantine(
                transaction,
                'queueCounters',
                rawCounter,
                'invalid_record',
                'Shared import found an invalid FIFO counter.',
                operationNow,
              );
              throw new EvaluationOfflineError(
                'corrupt_record',
                'Shared import cannot allocate from a corrupt FIFO counter.',
              );
            }
            const queueSequence = parsedCounter?.success ? parsedCounter.data.nextSequence : 1;
            const terminalMutation = storedMutationSchema.safeParse({
              storageKey,
              clientMutationId: item.clientMutationId,
              scopeKey: fullKey,
              queueKey,
              queueSequence,
              scope: parsedScope.data,
              evaluationId: item.evaluationId,
              expectedVersion: item.expectedVersion,
              draft: parsedDraft.data,
              payloadDigest,
              status: 'acknowledged',
              syncState: 'synced',
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
              nextAttemptAt: item.nextAttemptAt,
              attemptCount: item.attemptCount,
              acknowledgedAt,
            });
            if (!terminalMutation.success) {
              await this.addToQuarantine(
                transaction,
                'mutations',
                raw,
                'terminal_pair_inconsistent',
                'Shared terminal mutation cannot be represented safely.',
                operationNow,
              );
              await this.addToQuarantine(
                transaction,
                'receipts',
                receiptRaw,
                'terminal_pair_inconsistent',
                'Shared terminal receipt cannot be represented safely.',
                operationNow,
              );
              quarantined += 2;
              continue;
            }
            if ((await this.database.mutations.count()) >= this.quotas.maxMutations) {
              throw quotaError('mutations');
            }
            if ((await this.database.receipts.count()) >= this.quotas.maxReceipts) {
              throw quotaError('receipts');
            }
            await this.assertByteQuota(transaction, terminalMutation.data);
            await this.assertByteQuota(transaction, synthesizedReceipt);
            await this.database.queueCounters.put({
              queueKey,
              scopeKey: fullKey,
              nextSequence: queueSequence + 1,
            });
            await this.database.mutations.add(terminalMutation.data);
            await this.database.receipts.add(synthesizedReceipt);
            await this.ensureReceiptTombstone(
              transaction,
              parsedScope.data,
              item.clientMutationId as string,
              operationNow,
              synthesizedReceipt,
            );
            imported += 2;
            continue;
          }
          const queueKey = evaluationQueueKey(parsedScope.data, item.evaluationId as string);
          const rawCounter = await this.database.queueCounters.get(queueKey);
          const parsedCounter = rawCounter ? storedQueueCounterSchema.safeParse(rawCounter) : null;
          if (parsedCounter && !parsedCounter.success) {
            await this.moveToQuarantine(
              transaction,
              'queueCounters',
              rawCounter,
              'invalid_record',
              'Shared import found an invalid FIFO counter.',
              new Date(),
            );
            throw new EvaluationOfflineError(
              'corrupt_record',
              'Shared import cannot allocate from a corrupt FIFO counter.',
            );
          }
          const queueSequence = parsedCounter?.success ? parsedCounter.data.nextSequence : 1;
          const candidate: StoredEvaluationMutation = {
            storageKey,
            clientMutationId: item.clientMutationId as string,
            scopeKey: fullKey,
            queueKey,
            queueSequence,
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
            await this.database.queueCounters.put({
              queueKey,
              scopeKey: fullKey,
              nextSequence: queueSequence + 1,
            });
            await this.database.mutations.add(parsed.data);
            imported += 1;
          }
        }

        for (const raw of matching.get('receipts') ?? []) {
          if (consumedReceipts.has(raw)) continue;
          const item = raw as Record<string, unknown>;
          const parsedScope = evaluationScopeSchema.safeParse(item.scope);
          if (!parsedScope.success || parsedScope.data.userId !== this.authenticatedUserId)
            continue;
          await this.addToQuarantine(
            transaction,
            'receipts',
            raw,
            item.receiptDigest !== undefined ? 'digest_mismatch' : 'terminal_pair_inconsistent',
            'Shared terminal receipt has no validated mutation lineage.',
            new Date(),
          );
          quarantined += 1;
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
