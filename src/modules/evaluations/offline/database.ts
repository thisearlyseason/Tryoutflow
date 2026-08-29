import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { z } from 'zod';
import {
  assertJsonPostgresCompatible,
  isJsonPostgresCompatibleString,
} from '../../../lib/json-string-contract';

import { evaluationSyncStates, type EvaluationSyncState } from './sync-state';

export const EVALUATION_OFFLINE_DATABASE_VERSION = 5;
export const DEFAULT_EVALUATION_OFFLINE_DATABASE = 'tryoutflow-evaluations';

export type EvaluationStorageScope = {
  userId: string;
  evaluatorId: string;
  organizationId: string;
  tryoutId: string;
  sessionId: string;
  registrationId: string;
  rubricVersionId: string;
};

export type EvaluationDraftPayload = {
  scores: { categoryId: string; value: number }[];
  note?: string;
  noteTagIds: string[];
  flags: string[];
};

export type EvaluationStoredFailureCategory =
  | 'network'
  | 'server'
  | 'conflict'
  | 'forbidden'
  | 'invalid_input'
  | 'invalid_rubric'
  | 'retry_exhausted'
  | 'corrupt_record'
  | 'migration_review_required'
  | 'migration_context_required';

export type StoredEvaluationDraft = {
  scopeKey: string;
  scope: EvaluationStorageScope;
  evaluationId: string | null;
  expectedVersion: number;
  draft: EvaluationDraftPayload;
  payloadDigest: string;
  syncState: EvaluationSyncState;
  updatedAt: string;
  expiresAt: string;
};

export type StoredEvaluationMutation = {
  storageKey: string;
  clientMutationId: string;
  scopeKey: string;
  queueKey: string;
  queueSequence: number;
  scope: EvaluationStorageScope;
  evaluationId: string;
  expectedVersion: number;
  draft: EvaluationDraftPayload;
  payloadDigest: string;
  status: 'pending' | 'leased' | 'acknowledged' | 'needs_attention';
  syncState: EvaluationSyncState;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  attemptCount: number;
  claimToken?: string;
  leaseUntil?: string;
  errorCategory?: EvaluationStoredFailureCategory;
  lastError?: string;
  acknowledgedAt?: string;
  conflictServerEvaluationId?: string;
  conflictServerVersion?: number;
};

export type StoredEvaluationQueueCounter = {
  queueKey: string;
  scopeKey: string;
  nextSequence: number;
};

export type StoredEvaluationReceipt = {
  storageKey: string;
  clientMutationId: string;
  scopeKey: string;
  scope: EvaluationStorageScope;
  evaluationId: string;
  expectedVersion: number;
  payloadDigest: string;
  claimToken: string;
  serverVersion: number;
  acknowledgedAt: string;
  expiresAt: string;
  receiptDigest: string;
};

export type StoredEvaluationReceiptTombstone = {
  storageKey: string;
  scopeKey: string;
  clientMutationId: string;
  reason:
    | 'receipt_authority'
    | 'corrupt_receipt'
    | 'conflict_keep_local'
    | 'conflict_use_server'
    | 'conflict_dependent';
  createdAt: string;
  evaluationId?: string;
  expectedVersion?: number;
  payloadDigest?: string;
  serverVersion?: number;
  acknowledgedAt?: string;
  resolutionOriginalEvaluationId?: string;
  resolutionOriginalPayloadDigest?: string;
  resolutionOriginalQueueSequence?: number;
  resolutionServerEvaluationId?: string;
  resolutionServerVersion?: number;
  resolutionServerSnapshotDigest?: string;
  resolutionResultMutationId?: string;
  resolutionResultQueueSequence?: number;
  resolutionResultDraftDigest?: string;
  resolutionResultPayloadDigest?: string;
  resolutionResultMarker?: 'keep_local_rebased' | 'use_server_discarded';
  tombstoneDigest: string;
};

export type StoredSessionContext = {
  scopeKey: string;
  scope: EvaluationStorageScope;
  tryoutNumber: number | null;
  categories: {
    id: string;
    scaleMin: 1;
    scaleMax: 5 | 10;
    required: boolean;
  }[];
  expiresAt: string;
};

export type QuarantineSource =
  'sessionContexts' | 'drafts' | 'mutations' | 'receipts' | 'receiptTombstones' | 'queueCounters';
export type QuarantineReason =
  | 'invalid_record'
  | 'digest_mismatch'
  | 'physical_key_collision'
  | 'user_mismatch'
  | 'receipt_divergence'
  | 'terminal_pair_inconsistent';

export type EvaluationRecoveryEnvelope = {
  scopeKey?: string;
  clientMutationId?: string;
  evaluationId?: string;
  status?: string;
  expectedVersion?: number;
  serverVersion?: number;
  queueSequence?: number;
  payloadDigest?: string;
  receiptDigest?: string;
};

export type StoredEvaluationQuarantine = {
  quarantineKey: string;
  scopeKey?: string;
  sourceTable: QuarantineSource;
  sourceKey: string;
  reason: QuarantineReason;
  diagnostic: string;
  status: 'needs_attention';
  createdAt: string;
  recoveryEnvelope: EvaluationRecoveryEnvelope;
};

const uuid = z.uuid();
const isoDate = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
function isSafeRecoveryKey(value: string): boolean {
  if (!value) return true;
  return value.split('|').every((part, index) => {
    if (index > 0 && part.startsWith('evaluation:')) {
      return uuid.safeParse(part.slice('evaluation:'.length)).success;
    }
    return uuid.safeParse(part).success;
  });
}
export const evaluationMutationFailureCategorySchema = z.enum([
  'network',
  'server',
  'conflict',
  'forbidden',
  'invalid_input',
  'invalid_rubric',
  'retry_exhausted',
  'corrupt_record',
  'migration_review_required',
  'migration_context_required',
]);

export const evaluationScopeSchema = z.strictObject({
  userId: uuid,
  evaluatorId: uuid,
  organizationId: uuid,
  tryoutId: uuid,
  sessionId: uuid,
  registrationId: uuid,
  rubricVersionId: uuid,
});

export const evaluationDraftSchema = z.strictObject({
  scores: z
    .array(z.strictObject({ categoryId: uuid, value: z.number().int().min(1).max(10) }))
    .max(50)
    .refine((scores) => new Set(scores.map((score) => score.categoryId)).size === scores.length),
  note: z.string().max(4_000).refine(isJsonPostgresCompatibleString).optional(),
  noteTagIds: z
    .array(uuid)
    .max(25)
    .refine((ids) => new Set(ids).size === ids.length),
  flags: z
    .array(z.enum(['needs_another_look', 'injury_concern', 'eligibility_review']))
    .max(3)
    .refine((flags) => new Set(flags).size === flags.length),
});

const categorySchema = z.strictObject({
  id: uuid,
  scaleMin: z.literal(1),
  scaleMax: z.union([z.literal(5), z.literal(10)]),
  required: z.boolean(),
});

export const storedSessionContextSchema = z.strictObject({
  scopeKey: z.string().min(1).max(512),
  scope: evaluationScopeSchema,
  tryoutNumber: z.number().int().positive().max(999_999).nullable(),
  categories: z
    .array(categorySchema)
    .min(1)
    .max(50)
    .refine(
      (categories) => new Set(categories.map((category) => category.id)).size === categories.length,
    ),
  expiresAt: isoDate,
});

export const storedDraftSchema = z
  .strictObject({
    scopeKey: z.string().min(1).max(512),
    scope: evaluationScopeSchema,
    evaluationId: uuid.nullable(),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    draft: evaluationDraftSchema,
    payloadDigest: sha256,
    syncState: z.enum(['saved_device', 'synced', 'needs_attention']),
    updatedAt: isoDate,
    expiresAt: isoDate,
  })
  .refine((record) => Date.parse(record.updatedAt) < Date.parse(record.expiresAt), {
    message: 'Draft expiry must follow its update.',
  });

export const storedMutationSchema = z
  .strictObject({
    storageKey: z.string().min(1).max(600),
    clientMutationId: uuid,
    scopeKey: z.string().min(1).max(512),
    queueKey: z.string().min(1).max(600),
    queueSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    scope: evaluationScopeSchema,
    evaluationId: uuid,
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    draft: evaluationDraftSchema,
    payloadDigest: sha256,
    status: z.enum(['pending', 'leased', 'acknowledged', 'needs_attention']),
    syncState: z.enum(evaluationSyncStates),
    createdAt: isoDate,
    updatedAt: isoDate,
    nextAttemptAt: isoDate,
    attemptCount: z.number().int().min(0).max(100),
    claimToken: uuid.optional(),
    leaseUntil: isoDate.optional(),
    errorCategory: evaluationMutationFailureCategorySchema.optional(),
    lastError: z
      .string()
      .max(500)
      .refine((value) => new TextEncoder().encode(value).byteLength <= 500)
      .optional(),
    acknowledgedAt: isoDate.optional(),
    conflictServerEvaluationId: uuid.optional(),
    conflictServerVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .superRefine((record, context) => {
    if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
      context.addIssue({ code: 'custom', message: 'Mutation update predates creation.' });
    }
    const requiredSyncState = {
      pending: 'saved_device',
      leased: 'syncing',
      acknowledged: 'synced',
      needs_attention: 'needs_attention',
    }[record.status];
    if (record.syncState !== requiredSyncState) {
      context.addIssue({ code: 'custom', message: 'Mutation status and sync state diverge.' });
    }
    if (record.status === 'leased' && (!record.claimToken || !record.leaseUntil)) {
      context.addIssue({
        code: 'custom',
        message: 'A lease requires a fencing token and deadline.',
      });
    }
    if (
      record.status === 'leased' &&
      record.leaseUntil &&
      Date.parse(record.leaseUntil) <= Date.parse(record.updatedAt)
    ) {
      context.addIssue({ code: 'custom', message: 'Lease deadline must follow its update.' });
    }
    if (record.status !== 'leased' && (record.claimToken || record.leaseUntil)) {
      context.addIssue({ code: 'custom', message: 'Only leased work may carry lease fields.' });
    }
    if (record.status === 'acknowledged' && !record.acknowledgedAt) {
      context.addIssue({ code: 'custom', message: 'Acknowledged work requires a timestamp.' });
    }
    if (record.status !== 'acknowledged' && record.acknowledgedAt) {
      context.addIssue({
        code: 'custom',
        message: 'Only acknowledged work may carry acknowledgment.',
      });
    }
    if (record.status === 'needs_attention' && !record.errorCategory) {
      context.addIssue({ code: 'custom', message: 'Attention work requires a bounded category.' });
    }
    if (
      (record.conflictServerEvaluationId === undefined) !==
      (record.conflictServerVersion === undefined)
    ) {
      context.addIssue({ code: 'custom', message: 'Conflict server identity must be complete.' });
    }
    if (
      record.conflictServerEvaluationId !== undefined &&
      (record.status !== 'needs_attention' || record.errorCategory !== 'conflict')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only conflict attention stores server identity.',
      });
    }
  });

export const storedReceiptSchema = z
  .strictObject({
    storageKey: z.string().min(1).max(600),
    clientMutationId: uuid,
    scopeKey: z.string().min(1).max(512),
    scope: evaluationScopeSchema,
    evaluationId: uuid,
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    payloadDigest: sha256,
    claimToken: uuid,
    serverVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    acknowledgedAt: isoDate,
    expiresAt: isoDate,
    receiptDigest: sha256,
  })
  .refine((receipt) => Date.parse(receipt.acknowledgedAt) < Date.parse(receipt.expiresAt), {
    message: 'Receipt expiry must follow acknowledgment.',
  })
  .refine((receipt) => receipt.serverVersion === receipt.expectedVersion + 1, {
    message: 'Receipt server version must be the exact expected successor.',
  });

export const storedReceiptTombstoneSchema = z
  .strictObject({
    storageKey: z.string().min(1).max(600),
    scopeKey: z.string().min(1).max(512),
    clientMutationId: uuid,
    reason: z.enum([
      'receipt_authority',
      'corrupt_receipt',
      'conflict_keep_local',
      'conflict_use_server',
      'conflict_dependent',
    ]),
    createdAt: isoDate,
    evaluationId: uuid.optional(),
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    payloadDigest: sha256.optional(),
    serverVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    acknowledgedAt: isoDate.optional(),
    resolutionOriginalEvaluationId: uuid.optional(),
    resolutionOriginalPayloadDigest: sha256.optional(),
    resolutionOriginalQueueSequence: z
      .number()
      .int()
      .min(1)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    resolutionServerEvaluationId: uuid.optional(),
    resolutionServerVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    resolutionServerSnapshotDigest: sha256.optional(),
    resolutionResultMutationId: uuid.optional(),
    resolutionResultQueueSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    resolutionResultDraftDigest: sha256.optional(),
    resolutionResultPayloadDigest: sha256.optional(),
    resolutionResultMarker: z.enum(['keep_local_rebased', 'use_server_discarded']).optional(),
    tombstoneDigest: sha256,
  })
  .superRefine((record, context) => {
    const lineage = [
      record.evaluationId,
      record.expectedVersion,
      record.payloadDigest,
      record.serverVersion,
      record.acknowledgedAt,
    ];
    const present = lineage.filter((value) => value !== undefined).length;
    if (present !== 0 && present !== lineage.length) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal lineage must be complete or omitted.',
      });
    }
    if (
      record.expectedVersion !== undefined &&
      record.serverVersion !== record.expectedVersion + 1
    ) {
      context.addIssue({ code: 'custom', message: 'Terminal lineage version is not exact.' });
    }
    const resolution = [
      record.resolutionOriginalEvaluationId,
      record.resolutionOriginalPayloadDigest,
      record.resolutionOriginalQueueSequence,
      record.resolutionServerEvaluationId,
      record.resolutionServerVersion,
      record.resolutionServerSnapshotDigest,
      record.resolutionResultDraftDigest,
      record.resolutionResultPayloadDigest,
      record.resolutionResultMarker,
    ];
    const resolutionCount = resolution.filter((value) => value !== undefined).length;
    if (resolutionCount !== 0 && resolutionCount !== resolution.length) {
      context.addIssue({
        code: 'custom',
        message: 'Conflict resolution lineage must be complete.',
      });
    }
    if (
      resolutionCount > 0 &&
      !['conflict_keep_local', 'conflict_use_server'].includes(record.reason)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Only conflict heads store resolution lineage.',
      });
    }
    if (
      record.resolutionResultMarker === 'keep_local_rebased' &&
      (!record.resolutionResultMutationId || !record.resolutionResultQueueSequence)
    ) {
      context.addIssue({ code: 'custom', message: 'A local rebase requires successor lineage.' });
    }
    if (
      record.resolutionResultMarker === 'use_server_discarded' &&
      (record.resolutionResultMutationId || record.resolutionResultQueueSequence)
    ) {
      context.addIssue({ code: 'custom', message: 'A server discard cannot name a successor.' });
    }
  });

const safeRecoveryKey = z.string().max(600).refine(isSafeRecoveryKey);
const recoveryStatus = z.enum([
  'pending',
  'leased',
  'acknowledged',
  'needs_attention',
  'saving_local',
  'saved_device',
  'syncing',
  'synced',
]);

export const storedQuarantineSchema = z
  .strictObject({
    quarantineKey: uuid,
    scopeKey: safeRecoveryKey.min(1).max(512).optional(),
    sourceTable: z.enum([
      'sessionContexts',
      'drafts',
      'mutations',
      'receipts',
      'receiptTombstones',
      'queueCounters',
    ]),
    sourceKey: safeRecoveryKey,
    reason: z.enum([
      'invalid_record',
      'digest_mismatch',
      'physical_key_collision',
      'user_mismatch',
      'receipt_divergence',
      'terminal_pair_inconsistent',
    ]),
    diagnostic: z
      .string()
      .min(1)
      .max(500)
      .refine((value) => new TextEncoder().encode(value).byteLength <= 500),
    status: z.literal('needs_attention'),
    createdAt: isoDate,
    recoveryEnvelope: z.strictObject({
      scopeKey: safeRecoveryKey.min(1).max(512).optional(),
      clientMutationId: uuid.optional(),
      evaluationId: uuid.optional(),
      status: recoveryStatus.optional(),
      expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
      serverVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
      queueSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
      payloadDigest: sha256.optional(),
      receiptDigest: sha256.optional(),
    }),
  })
  .refine(
    (record) => new TextEncoder().encode(JSON.stringify(record)).byteLength <= 4_096,
    'Quarantine recovery metadata exceeds its byte budget.',
  );

export const storedQueueCounterSchema = z.strictObject({
  queueKey: z.string().min(1).max(600),
  scopeKey: z.string().min(1).max(512),
  nextSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

type IndexedDbFactory = IDBFactory;

export class EvaluationOfflineDatabase extends Dexie {
  sessionContexts!: EntityTable<StoredSessionContext, 'scopeKey'>;
  drafts!: EntityTable<StoredEvaluationDraft, 'scopeKey'>;
  mutations!: EntityTable<StoredEvaluationMutation, 'storageKey'>;
  receipts!: EntityTable<StoredEvaluationReceipt, 'storageKey'>;
  receiptTombstones!: EntityTable<StoredEvaluationReceiptTombstone, 'storageKey'>;
  quarantines!: EntityTable<StoredEvaluationQuarantine, 'quarantineKey'>;
  queueCounters!: EntityTable<StoredEvaluationQueueCounter, 'queueKey'>;

  constructor(
    name: string,
    indexedDb: IndexedDbFactory,
    keyRange: typeof IDBKeyRange,
    authenticatedUserId: string,
  ) {
    super(name, { indexedDB: indexedDb, IDBKeyRange: keyRange });

    // The shipped v1 used bare UUID primary keys. These declarations must match
    // that physical history so real installations can traverse v1 -> v2 -> v3.
    this.version(1).stores({
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations: '&storageKey,&clientMutationId,status,createdAt,nextAttemptAt',
    });

    this.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });

    this.version(3)
      .stores({
        sessionContexts: '&scopeKey,expiresAt',
        drafts: '&scopeKey,updatedAt,expiresAt',
        mutations:
          '&storageKey,&clientMutationId,scopeKey,queueKey,status,[scopeKey+status],createdAt,nextAttemptAt',
        receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
        quarantines: '&quarantineKey,scopeKey,sourceTable,status,createdAt',
      })
      .upgrade((transaction) => migrateToVersionThree(transaction, authenticatedUserId));

    this.version(4)
      .stores({
        sessionContexts: '&scopeKey,expiresAt',
        drafts: '&scopeKey,updatedAt,expiresAt',
        mutations:
          '&storageKey,&clientMutationId,scopeKey,queueKey,[queueKey+queueSequence],status,[scopeKey+status],createdAt,nextAttemptAt',
        receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
        quarantines: '&quarantineKey,scopeKey,sourceTable,status,createdAt',
        queueCounters: '&queueKey,scopeKey,nextSequence',
      })
      .upgrade((transaction) => migrateToVersionFour(transaction, authenticatedUserId));

    this.version(EVALUATION_OFFLINE_DATABASE_VERSION)
      .stores({
        sessionContexts: '&scopeKey,expiresAt',
        drafts: '&scopeKey,updatedAt,expiresAt',
        mutations:
          '&storageKey,&clientMutationId,scopeKey,queueKey,[queueKey+queueSequence],status,[scopeKey+status],createdAt,nextAttemptAt',
        receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
        receiptTombstones: '&storageKey,scopeKey,createdAt',
        quarantines: '&quarantineKey,scopeKey,sourceTable,status,createdAt',
        queueCounters: '&queueKey,scopeKey,nextSequence',
      })
      .upgrade((transaction) => migrateToVersionFive(transaction, authenticatedUserId));
  }
}

export function evaluationDatabaseName(baseName: string, authenticatedUserId: string): string {
  const parsed = uuid.safeParse(authenticatedUserId);
  if (!parsed.success || !/^[a-zA-Z0-9._-]{1,120}$/.test(baseName)) {
    throw new Error('Invalid evaluation database identity.');
  }
  // An auth UUID is already an opaque stable identifier. Removing punctuation
  // keeps the IndexedDB name inert while retaining deterministic per-user routing.
  return `${baseName}--u-${parsed.data.replaceAll('-', '').toLowerCase()}`;
}

export function scopeKey(scope: EvaluationStorageScope): string {
  return [
    scope.userId,
    scope.evaluatorId,
    scope.organizationId,
    scope.tryoutId,
    scope.sessionId,
    scope.registrationId,
    scope.rubricVersionId,
  ].join('|');
}

export function evaluationQueueKey(scope: EvaluationStorageScope, evaluationId: string): string {
  return `${scopeKey(scope)}|evaluation:${evaluationId}`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`;
}

/** A stable integrity/idempotency digest; it is not encryption. */
export async function digestValue(value: unknown): Promise<string> {
  assertJsonPostgresCompatible(value);
  const source = canonicalize(value);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function evaluationPayload(
  scope: EvaluationStorageScope,
  evaluationId: string | null,
  expectedVersion: number,
  draft: EvaluationDraftPayload,
) {
  return { scope, evaluationId, expectedVersion, draft };
}

export function receiptTombstonePayload(
  tombstone: Omit<StoredEvaluationReceiptTombstone, 'tombstoneDigest'>,
) {
  return tombstone;
}

function sourceKey(sourceTable: QuarantineSource, record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const item = record as Record<string, unknown>;
  const candidate =
    sourceTable === 'mutations' || sourceTable === 'receipts' || sourceTable === 'receiptTombstones'
      ? (item.storageKey ?? item.clientMutationId)
      : sourceTable === 'queueCounters'
        ? item.queueKey
        : item.scopeKey;
  const bounded = typeof candidate === 'string' ? candidate.slice(0, 600) : '';
  return isSafeRecoveryKey(bounded) ? bounded : '';
}

function safeString(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, maximum) : undefined;
}

function boundedUtf8(value: string, maximumBytes: number): string {
  let result = '';
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const character of value) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > maximumBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function recoveryEnvelope(record: unknown): EvaluationRecoveryEnvelope {
  const item = record && typeof record === 'object' ? (record as Record<string, unknown>) : {};
  const parsedScope = evaluationScopeSchema.safeParse(item.scope);
  const parsedClientMutationId = uuid.safeParse(item.clientMutationId);
  const parsedEvaluationId = uuid.safeParse(item.evaluationId);
  const parsedPayloadDigest = sha256.safeParse(item.payloadDigest);
  const parsedReceiptDigest = sha256.safeParse(item.receiptDigest);
  const parsedStatus = recoveryStatus.safeParse(item.status);
  const rawScopeKey = safeString(item.scopeKey, 512);
  const safeScopeKey = rawScopeKey && isSafeRecoveryKey(rawScopeKey) ? rawScopeKey : undefined;
  const expectedVersion =
    Number.isSafeInteger(item.expectedVersion) && Number(item.expectedVersion) >= 0
      ? (item.expectedVersion as number)
      : undefined;
  const serverVersion =
    Number.isSafeInteger(item.serverVersion) && Number(item.serverVersion) >= 1
      ? (item.serverVersion as number)
      : undefined;
  const queueSequence =
    Number.isSafeInteger(item.queueSequence) && Number(item.queueSequence) >= 1
      ? (item.queueSequence as number)
      : undefined;
  return {
    ...(parsedScope.success
      ? { scopeKey: scopeKey(parsedScope.data) }
      : safeScopeKey
        ? { scopeKey: safeScopeKey }
        : {}),
    ...(parsedClientMutationId.success ? { clientMutationId: parsedClientMutationId.data } : {}),
    ...(parsedEvaluationId.success ? { evaluationId: parsedEvaluationId.data } : {}),
    ...(parsedStatus.success ? { status: parsedStatus.data } : {}),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(serverVersion === undefined ? {} : { serverVersion }),
    ...(queueSequence === undefined ? {} : { queueSequence }),
    ...(parsedPayloadDigest.success ? { payloadDigest: parsedPayloadDigest.data } : {}),
    ...(parsedReceiptDigest.success ? { receiptDigest: parsedReceiptDigest.data } : {}),
  };
}

function quarantine(
  sourceTable: QuarantineSource,
  record: unknown,
  reason: QuarantineReason,
  diagnostic: string,
  authenticatedUserId: string,
  now: string,
): StoredEvaluationQuarantine {
  const rawScope =
    record && typeof record === 'object' ? (record as Record<string, unknown>).scope : undefined;
  const parsedScope = evaluationScopeSchema.safeParse(rawScope);
  const trustedScopeKey =
    parsedScope.success && parsedScope.data.userId === authenticatedUserId
      ? scopeKey(parsedScope.data)
      : undefined;
  const candidate = {
    quarantineKey: crypto.randomUUID(),
    ...(trustedScopeKey ? { scopeKey: trustedScopeKey } : {}),
    sourceTable,
    sourceKey: sourceKey(sourceTable, record),
    reason,
    diagnostic: boundedUtf8(diagnostic, 500),
    status: 'needs_attention',
    createdAt: now,
    recoveryEnvelope: recoveryEnvelope(record),
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
    createdAt: isoDate.safeParse(now).success ? now : new Date().toISOString(),
    recoveryEnvelope: {},
  });
}

function commonMigrationFields(record: Record<string, unknown>, now: string) {
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : now;
  return {
    createdAt,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : createdAt,
    nextAttemptAt: typeof record.nextAttemptAt === 'string' ? record.nextAttemptAt : createdAt,
    attemptCount: typeof record.attemptCount === 'number' ? record.attemptCount : 0,
  };
}

async function migrateToVersionThree(
  transaction: Transaction,
  authenticatedUserId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const sourceTables: QuarantineSource[] = ['sessionContexts', 'drafts', 'mutations', 'receipts'];
  const rawByTable = new Map<QuarantineSource, unknown[]>();
  for (const table of sourceTables) rawByTable.set(table, await transaction.table(table).toArray());

  const quarantines: StoredEvaluationQuarantine[] = [];
  const contexts: StoredSessionContext[] = [];
  const drafts: StoredEvaluationDraft[] = [];
  const mutations: StoredEvaluationMutation[] = [];
  const receipts: StoredEvaluationReceipt[] = [];
  const legacyReceiptsByMutationId = new Map<string, unknown>();
  const consumedLegacyReceiptIds = new Set<string>();
  for (const raw of rawByTable.get('receipts') ?? []) {
    const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (typeof item.clientMutationId === 'string') {
      legacyReceiptsByMutationId.set(item.clientMutationId, raw);
    }
  }

  for (const raw of rawByTable.get('sessionContexts') ?? []) {
    const item = raw as Record<string, unknown>;
    const parsedScope = evaluationScopeSchema.safeParse(item.scope);
    if (!parsedScope.success || parsedScope.data.userId !== authenticatedUserId) {
      quarantines.push(
        quarantine(
          'sessionContexts',
          raw,
          parsedScope.success ? 'user_mismatch' : 'invalid_record',
          'Legacy context ownership or shape is invalid.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const candidate = {
      scopeKey: scopeKey(parsedScope.data),
      scope: parsedScope.data,
      tryoutNumber: item.tryoutNumber ?? null,
      categories: item.categories,
      expiresAt: item.expiresAt,
    };
    const parsed = storedSessionContextSchema.safeParse(candidate);
    if (!parsed.success) {
      quarantines.push(
        quarantine(
          'sessionContexts',
          raw,
          'invalid_record',
          'Legacy context failed strict validation.',
          authenticatedUserId,
          now,
        ),
      );
    } else contexts.push(parsed.data);
  }

  const contextKeys = new Set(contexts.map((context) => context.scopeKey));
  for (const raw of rawByTable.get('drafts') ?? []) {
    const item = raw as Record<string, unknown>;
    const parsedScope = evaluationScopeSchema.safeParse(item.scope);
    const parsedDraft = evaluationDraftSchema.safeParse(item.draft);
    if (
      !parsedScope.success ||
      parsedScope.data.userId !== authenticatedUserId ||
      !parsedDraft.success
    ) {
      quarantines.push(
        quarantine(
          'drafts',
          raw,
          parsedScope.success && parsedScope.data.userId !== authenticatedUserId
            ? 'user_mismatch'
            : 'invalid_record',
          'Legacy draft ownership or shape is invalid.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const expectedVersion = item.expectedVersion;
    const evaluationId = item.evaluationId ?? null;
    if (
      !Number.isSafeInteger(expectedVersion) ||
      !(evaluationId === null || uuid.safeParse(evaluationId).success)
    ) {
      quarantines.push(
        quarantine(
          'drafts',
          raw,
          'invalid_record',
          'Legacy draft context is invalid.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const digest = await Dexie.waitFor(
      digestValue(
        evaluationPayload(
          parsedScope.data,
          evaluationId as string | null,
          expectedVersion as number,
          parsedDraft.data,
        ),
      ),
    );
    if (item.payloadDigest !== undefined && item.payloadDigest !== digest) {
      quarantines.push(
        quarantine(
          'drafts',
          raw,
          'digest_mismatch',
          'Legacy draft integrity digest does not match.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const candidate = {
      scopeKey: scopeKey(parsedScope.data),
      scope: parsedScope.data,
      evaluationId,
      expectedVersion,
      draft: parsedDraft.data,
      payloadDigest: digest,
      syncState: item.syncState === 'synced' ? 'synced' : 'saved_device',
      updatedAt: item.updatedAt,
      expiresAt: item.expiresAt,
    };
    const parsed = storedDraftSchema.safeParse(candidate);
    if (!parsed.success)
      quarantines.push(
        quarantine(
          'drafts',
          raw,
          'invalid_record',
          'Legacy draft dates or state are invalid.',
          authenticatedUserId,
          now,
        ),
      );
    else drafts.push(parsed.data);
  }

  for (const raw of rawByTable.get('mutations') ?? []) {
    const item = raw as Record<string, unknown>;
    const parsedScope = evaluationScopeSchema.safeParse(item.scope);
    const parsedDraft = evaluationDraftSchema.safeParse(item.draft);
    if (
      !parsedScope.success ||
      parsedScope.data.userId !== authenticatedUserId ||
      !parsedDraft.success
    ) {
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          parsedScope.success && parsedScope.data.userId !== authenticatedUserId
            ? 'user_mismatch'
            : 'invalid_record',
          'Legacy mutation ownership or shape is invalid.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    if (
      !uuid.safeParse(item.clientMutationId).success ||
      !uuid.safeParse(item.evaluationId).success ||
      !Number.isSafeInteger(item.expectedVersion)
    ) {
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          'invalid_record',
          'Legacy mutation identifiers are invalid.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    if (!['pending', 'leased', 'acknowledged', 'needs_attention'].includes(String(item.status))) {
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          'invalid_record',
          'Legacy mutation status is unknown.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const fullScopeKey = scopeKey(parsedScope.data);
    const digest = await Dexie.waitFor(
      digestValue(
        evaluationPayload(
          parsedScope.data,
          item.evaluationId as string,
          item.expectedVersion as number,
          parsedDraft.data,
        ),
      ),
    );
    if (item.payloadDigest !== undefined && item.payloadDigest !== digest) {
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          'digest_mismatch',
          'Legacy mutation integrity digest does not match.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const migratedStatus = contextKeys.has(fullScopeKey)
      ? item.status === 'leased'
        ? 'pending'
        : item.status
      : 'needs_attention';
    const fields = commonMigrationFields(item, now);
    const candidate = {
      storageKey: `${fullScopeKey}|${item.clientMutationId as string}`,
      clientMutationId: item.clientMutationId,
      scopeKey: fullScopeKey,
      queueKey: evaluationQueueKey(parsedScope.data, item.evaluationId as string),
      queueSequence: 1,
      scope: parsedScope.data,
      evaluationId: item.evaluationId,
      expectedVersion: item.expectedVersion,
      draft: parsedDraft.data,
      payloadDigest: digest,
      status: migratedStatus,
      syncState:
        migratedStatus === 'acknowledged'
          ? 'synced'
          : migratedStatus === 'needs_attention'
            ? 'needs_attention'
            : 'saved_device',
      ...fields,
      ...(migratedStatus === 'needs_attention'
        ? {
            errorCategory: contextKeys.has(fullScopeKey)
              ? (item.errorCategory ?? 'migration_review_required')
              : 'migration_context_required',
            lastError: 'Migrated offline work requires explicit review.',
          }
        : {}),
      ...(migratedStatus === 'acknowledged' && typeof item.acknowledgedAt === 'string'
        ? { acknowledgedAt: item.acknowledgedAt }
        : {}),
    };
    const parsed = storedMutationSchema.safeParse(candidate);
    if (!parsed.success)
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          'invalid_record',
          'Legacy mutation dates or state are invalid.',
          authenticatedUserId,
          now,
        ),
      );
    else {
      const legacyReceipt = legacyReceiptsByMutationId.get(parsed.data.clientMutationId);
      if (parsed.data.status === 'acknowledged' || legacyReceipt) {
        const receiptItem =
          legacyReceipt && typeof legacyReceipt === 'object'
            ? (legacyReceipt as Record<string, unknown>)
            : null;
        const parsedReceiptScope = evaluationScopeSchema.safeParse(receiptItem?.scope);
        const legacyPairIsConsistent =
          parsed.data.status === 'acknowledged' &&
          receiptItem !== null &&
          parsedReceiptScope.success &&
          scopeKey(parsedReceiptScope.data) === parsed.data.scopeKey &&
          receiptItem.storageKey === parsed.data.storageKey &&
          receiptItem.scopeKey === parsed.data.scopeKey &&
          receiptItem.clientMutationId === parsed.data.clientMutationId &&
          receiptItem.evaluationId === parsed.data.evaluationId &&
          receiptItem.serverVersion === parsed.data.expectedVersion + 1 &&
          receiptItem.acknowledgedAt === parsed.data.acknowledgedAt;
        if (!legacyPairIsConsistent) {
          quarantines.push(
            quarantine(
              'mutations',
              raw,
              'terminal_pair_inconsistent',
              'Legacy terminal mutation and receipt are not jointly consistent.',
              authenticatedUserId,
              now,
            ),
          );
          if (legacyReceipt) {
            consumedLegacyReceiptIds.add(parsed.data.clientMutationId);
            quarantines.push(
              quarantine(
                'receipts',
                legacyReceipt,
                'terminal_pair_inconsistent',
                'Legacy terminal receipt and mutation are not jointly consistent.',
                authenticatedUserId,
                now,
              ),
            );
          }
          continue;
        }
        consumedLegacyReceiptIds.add(parsed.data.clientMutationId);
        const strictExisting = storedReceiptSchema.safeParse({
          ...receiptItem,
          scope: parsedReceiptScope.data,
          scopeKey: parsed.data.scopeKey,
          storageKey: parsed.data.storageKey,
        });
        if (strictExisting.success) {
          const { receiptDigest, ...payload } = strictExisting.data;
          const recomputedReceiptDigest = await Dexie.waitFor(digestValue(payload));
          if (
            receiptDigest !== recomputedReceiptDigest ||
            strictExisting.data.payloadDigest !== parsed.data.payloadDigest ||
            strictExisting.data.expectedVersion !== parsed.data.expectedVersion
          ) {
            quarantines.push(
              quarantine(
                'mutations',
                raw,
                'terminal_pair_inconsistent',
                'Legacy terminal integrity lineage does not match.',
                authenticatedUserId,
                now,
              ),
              quarantine(
                'receipts',
                legacyReceipt,
                'terminal_pair_inconsistent',
                'Legacy terminal integrity lineage does not match.',
                authenticatedUserId,
                now,
              ),
            );
            continue;
          }
          receipts.push(strictExisting.data);
        } else {
          const claimToken = crypto.randomUUID();
          const withoutDigest: Omit<StoredEvaluationReceipt, 'receiptDigest'> = {
            storageKey: parsed.data.storageKey,
            clientMutationId: parsed.data.clientMutationId,
            scopeKey: parsed.data.scopeKey,
            scope: parsed.data.scope,
            evaluationId: parsed.data.evaluationId,
            expectedVersion: parsed.data.expectedVersion,
            payloadDigest: parsed.data.payloadDigest,
            claimToken,
            serverVersion: receiptItem!.serverVersion as number,
            acknowledgedAt: receiptItem!.acknowledgedAt as string,
            expiresAt: receiptItem!.expiresAt as string,
          };
          const synthesized = storedReceiptSchema.safeParse({
            ...withoutDigest,
            receiptDigest: await Dexie.waitFor(digestValue(withoutDigest)),
          });
          if (!synthesized.success) {
            quarantines.push(
              quarantine(
                'mutations',
                raw,
                'terminal_pair_inconsistent',
                'Legacy terminal pair could not be synthesized safely.',
                authenticatedUserId,
                now,
              ),
              quarantine(
                'receipts',
                legacyReceipt,
                'terminal_pair_inconsistent',
                'Legacy terminal pair could not be synthesized safely.',
                authenticatedUserId,
                now,
              ),
            );
            continue;
          }
          receipts.push(synthesized.data);
        }
      }
      mutations.push(parsed.data);
    }
  }

  for (const raw of rawByTable.get('receipts') ?? []) {
    const item = raw as Record<string, unknown>;
    if (
      typeof item.clientMutationId === 'string' &&
      consumedLegacyReceiptIds.has(item.clientMutationId)
    ) {
      continue;
    }
    const parsedScope = evaluationScopeSchema.safeParse(item.scope);
    if (!parsedScope.success || parsedScope.data.userId !== authenticatedUserId) {
      quarantines.push(
        quarantine(
          'receipts',
          raw,
          parsedScope.success ? 'user_mismatch' : 'invalid_record',
          'Legacy receipt ownership is invalid.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const candidate = { ...item, scope: parsedScope.data, scopeKey: scopeKey(parsedScope.data) };
    const parsed = storedReceiptSchema.safeParse(candidate);
    if (!parsed.success)
      quarantines.push(
        quarantine(
          'receipts',
          raw,
          'invalid_record',
          'Legacy receipt failed strict validation.',
          authenticatedUserId,
          now,
        ),
      );
    else receipts.push(parsed.data);
  }

  const resolveCollisions = <T>(
    sourceTable: QuarantineSource,
    values: T[],
    keyOf: (value: T) => string,
  ): T[] => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(keyOf(value), (counts.get(keyOf(value)) ?? 0) + 1);
    return values.filter((value) => {
      if (counts.get(keyOf(value)) === 1) return true;
      quarantines.push(
        quarantine(
          sourceTable,
          value,
          'physical_key_collision',
          'Multiple legacy records map to one v3 physical key.',
          authenticatedUserId,
          now,
        ),
      );
      return false;
    });
  };

  const validContexts = resolveCollisions('sessionContexts', contexts, (value) => value.scopeKey);
  const validDrafts = resolveCollisions('drafts', drafts, (value) => value.scopeKey);
  const validMutations = resolveCollisions('mutations', mutations, (value) => value.storageKey);
  const validReceipts = resolveCollisions('receipts', receipts, (value) => value.storageKey);

  const mutationsByQueue = new Map<string, StoredEvaluationMutation[]>();
  for (const mutation of validMutations) {
    const queue = mutationsByQueue.get(mutation.queueKey) ?? [];
    queue.push(mutation);
    mutationsByQueue.set(mutation.queueKey, queue);
  }
  for (const queue of mutationsByQueue.values()) {
    queue
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.storageKey.localeCompare(right.storageKey),
      )
      .forEach((mutation, index) => {
        mutation.queueSequence = index + 1;
      });
  }

  if (
    quarantines.length > 500 ||
    new TextEncoder().encode(JSON.stringify(quarantines)).byteLength > 2 * 1_024 * 1_024
  ) {
    throw new Error('Legacy evaluation recovery metadata exceeds the bounded migration budget.');
  }

  for (const sourceTable of sourceTables) await transaction.table(sourceTable).clear();
  if (validContexts.length) await transaction.table('sessionContexts').bulkPut(validContexts);
  if (validDrafts.length) await transaction.table('drafts').bulkPut(validDrafts);
  if (validMutations.length) await transaction.table('mutations').bulkPut(validMutations);
  if (validReceipts.length) await transaction.table('receipts').bulkPut(validReceipts);
  if (quarantines.length) await transaction.table('quarantines').bulkPut(quarantines);
}

async function migrateToVersionFour(
  transaction: Transaction,
  authenticatedUserId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const rawMutations = await transaction.table('mutations').toArray();
  const rawReceipts = await transaction.table('receipts').toArray();
  const rawQuarantines = await transaction.table('quarantines').toArray();
  const quarantines: StoredEvaluationQuarantine[] = [];

  for (const raw of rawQuarantines) {
    const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const sourceTable = [
      'sessionContexts',
      'drafts',
      'mutations',
      'receipts',
      'receiptTombstones',
      'queueCounters',
    ].includes(String(item.sourceTable))
      ? (item.sourceTable as QuarantineSource)
      : 'mutations';
    const reason = [
      'invalid_record',
      'digest_mismatch',
      'physical_key_collision',
      'user_mismatch',
      'receipt_divergence',
      'terminal_pair_inconsistent',
    ].includes(String(item.reason))
      ? (item.reason as QuarantineReason)
      : 'invalid_record';
    const migrated = storedQuarantineSchema.safeParse({
      quarantineKey: uuid.safeParse(item.quarantineKey).success
        ? item.quarantineKey
        : crypto.randomUUID(),
      ...(typeof item.scopeKey === 'string' &&
      item.scopeKey.length > 0 &&
      isSafeRecoveryKey(item.scopeKey.slice(0, 512))
        ? { scopeKey: item.scopeKey.slice(0, 512) }
        : {}),
      sourceTable,
      sourceKey:
        typeof item.sourceKey === 'string' && isSafeRecoveryKey(item.sourceKey.slice(0, 600))
          ? item.sourceKey.slice(0, 600)
          : sourceKey(sourceTable, item.originalRecord ?? item).slice(0, 600),
      reason,
      diagnostic:
        typeof item.diagnostic === 'string' && item.diagnostic.length
          ? boundedUtf8(item.diagnostic, 500)
          : 'Legacy recovery metadata was normalized.',
      status: 'needs_attention',
      createdAt: isoDate.safeParse(item.createdAt).success ? item.createdAt : now,
      recoveryEnvelope: recoveryEnvelope(item.originalRecord ?? item.recoveryEnvelope ?? item),
    });
    if (!migrated.success) {
      throw new Error('Legacy quarantine metadata cannot be migrated without data loss.');
    }
    quarantines.push(migrated.data);
  }

  const receipts = new Map<string, StoredEvaluationReceipt>();
  for (const raw of rawReceipts) {
    const parsed = storedReceiptSchema.safeParse(raw);
    if (parsed.success) {
      const { receiptDigest, ...payload } = parsed.data;
      const expected = await Dexie.waitFor(digestValue(payload));
      if (receiptDigest === expected && parsed.data.scope.userId === authenticatedUserId) {
        receipts.set(parsed.data.storageKey, parsed.data);
        continue;
      }
    }
    quarantines.push(
      quarantine(
        'receipts',
        raw,
        'digest_mismatch',
        'Version-three receipt failed strict terminal integrity validation.',
        authenticatedUserId,
        now,
      ),
    );
  }

  const preliminary: StoredEvaluationMutation[] = [];
  for (const raw of rawMutations) {
    const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const candidate = storedMutationSchema.safeParse({ ...item, queueSequence: 1 });
    if (!candidate.success || candidate.data.scope.userId !== authenticatedUserId) {
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          'invalid_record',
          'Version-three mutation failed strict migration validation.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const computedPayloadDigest = await Dexie.waitFor(
      digestValue(
        evaluationPayload(
          candidate.data.scope,
          candidate.data.evaluationId,
          candidate.data.expectedVersion,
          candidate.data.draft,
        ),
      ),
    );
    if (computedPayloadDigest !== candidate.data.payloadDigest) {
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          'digest_mismatch',
          'Version-three mutation payload integrity does not match.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    const receipt = receipts.get(candidate.data.storageKey);
    if (receipt) {
      const exact =
        receipt.scopeKey === candidate.data.scopeKey &&
        receipt.evaluationId === candidate.data.evaluationId &&
        receipt.clientMutationId === candidate.data.clientMutationId &&
        receipt.expectedVersion === candidate.data.expectedVersion &&
        receipt.payloadDigest === candidate.data.payloadDigest &&
        receipt.serverVersion === candidate.data.expectedVersion + 1;
      if (!exact) {
        quarantines.push(
          quarantine(
            'mutations',
            raw,
            'receipt_divergence',
            'Mutation diverges from its authoritative terminal receipt.',
            authenticatedUserId,
            now,
          ),
        );
        continue;
      }
      preliminary.push({
        ...candidate.data,
        status: 'acknowledged',
        syncState: 'synced',
        acknowledgedAt: receipt.acknowledgedAt,
        updatedAt:
          candidate.data.updatedAt < receipt.acknowledgedAt
            ? receipt.acknowledgedAt
            : candidate.data.updatedAt,
        claimToken: undefined,
        leaseUntil: undefined,
        errorCategory: undefined,
        lastError: undefined,
      });
      continue;
    }
    if (candidate.data.status === 'acknowledged') {
      quarantines.push(
        quarantine(
          'mutations',
          raw,
          'terminal_pair_inconsistent',
          'Acknowledged version-three work has no authoritative receipt.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }
    preliminary.push(candidate.data);
  }

  const byQueue = new Map<string, StoredEvaluationMutation[]>();
  for (const mutation of preliminary) {
    const queue = byQueue.get(mutation.queueKey) ?? [];
    queue.push(mutation);
    byQueue.set(mutation.queueKey, queue);
  }
  const mutations: StoredEvaluationMutation[] = [];
  const counters: StoredEvaluationQueueCounter[] = [];
  for (const [queueKey, queue] of byQueue) {
    queue.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.storageKey.localeCompare(right.storageKey),
    );
    queue.forEach((mutation, index) => {
      mutations.push({ ...mutation, queueSequence: index + 1 });
    });
    counters.push({ queueKey, scopeKey: queue[0]!.scopeKey, nextSequence: queue.length + 1 });
  }

  if (
    quarantines.length > 500 ||
    new TextEncoder().encode(JSON.stringify(quarantines)).byteLength > 2 * 1_024 * 1_024
  ) {
    throw new Error('Evaluation recovery metadata exceeds the bounded migration budget.');
  }
  await transaction.table('mutations').clear();
  await transaction.table('receipts').clear();
  await transaction.table('quarantines').clear();
  await transaction.table('queueCounters').clear();
  if (mutations.length) await transaction.table('mutations').bulkPut(mutations);
  if (receipts.size) await transaction.table('receipts').bulkPut([...receipts.values()]);
  if (quarantines.length) await transaction.table('quarantines').bulkPut(quarantines);
  if (counters.length) await transaction.table('queueCounters').bulkPut(counters);
}

function parseReceiptStorageKey(
  storageKey: unknown,
  authenticatedUserId: string,
): { scope: EvaluationStorageScope; scopeKey: string; clientMutationId: string } | null {
  if (typeof storageKey !== 'string') return null;
  const parts = storageKey.split('|');
  if (parts.length !== 8) return null;
  const parsedScope = evaluationScopeSchema.safeParse({
    userId: parts[0],
    evaluatorId: parts[1],
    organizationId: parts[2],
    tryoutId: parts[3],
    sessionId: parts[4],
    registrationId: parts[5],
    rubricVersionId: parts[6],
  });
  const parsedMutationId = uuid.safeParse(parts[7]);
  if (
    !parsedScope.success ||
    parsedScope.data.userId !== authenticatedUserId ||
    !parsedMutationId.success
  ) {
    return null;
  }
  return {
    scope: parsedScope.data,
    scopeKey: scopeKey(parsedScope.data),
    clientMutationId: parsedMutationId.data,
  };
}

async function migrateToVersionFive(
  transaction: Transaction,
  authenticatedUserId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const rawReceipts = await transaction.table('receipts').toArray();
  const retainedReceipts: StoredEvaluationReceipt[] = [];
  const tombstones: StoredEvaluationReceiptTombstone[] = [];
  const quarantines: StoredEvaluationQuarantine[] = [];

  for (const raw of rawReceipts) {
    const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const physical = parseReceiptStorageKey(item.storageKey, authenticatedUserId);
    if (!physical) {
      quarantines.push(
        quarantine(
          'receipts',
          raw,
          'invalid_record',
          'Version-four receipt has no trusted deterministic physical identity.',
          authenticatedUserId,
          now,
        ),
      );
      continue;
    }

    const parsed = storedReceiptSchema.safeParse(raw);
    let validReceipt: StoredEvaluationReceipt | null = null;
    if (
      parsed.success &&
      parsed.data.storageKey === item.storageKey &&
      parsed.data.scopeKey === physical.scopeKey &&
      parsed.data.clientMutationId === physical.clientMutationId &&
      scopeKey(parsed.data.scope) === physical.scopeKey
    ) {
      const { receiptDigest, ...payload } = parsed.data;
      if (receiptDigest === (await Dexie.waitFor(digestValue(payload)))) {
        validReceipt = parsed.data;
      }
    }

    const withoutDigest: Omit<StoredEvaluationReceiptTombstone, 'tombstoneDigest'> = validReceipt
      ? {
          storageKey: item.storageKey as string,
          scopeKey: physical.scopeKey,
          clientMutationId: physical.clientMutationId,
          reason: 'receipt_authority',
          createdAt: validReceipt.acknowledgedAt,
          evaluationId: validReceipt.evaluationId,
          expectedVersion: validReceipt.expectedVersion,
          payloadDigest: validReceipt.payloadDigest,
          serverVersion: validReceipt.serverVersion,
          acknowledgedAt: validReceipt.acknowledgedAt,
        }
      : {
          storageKey: item.storageKey as string,
          scopeKey: physical.scopeKey,
          clientMutationId: physical.clientMutationId,
          reason: 'corrupt_receipt',
          createdAt: now,
        };
    tombstones.push({
      ...withoutDigest,
      tombstoneDigest: await Dexie.waitFor(digestValue(receiptTombstonePayload(withoutDigest))),
    });
    if (validReceipt) {
      retainedReceipts.push(validReceipt);
    } else {
      quarantines.push(
        quarantine(
          'receipts',
          {
            ...raw,
            scope: physical.scope,
            scopeKey: physical.scopeKey,
            clientMutationId: physical.clientMutationId,
          },
          'digest_mismatch',
          'Version-four receipt was fenced by a deterministic recovery tombstone.',
          authenticatedUserId,
          now,
        ),
      );
    }
  }

  if (
    (await transaction.table('quarantines').count()) + quarantines.length > 500 ||
    new TextEncoder().encode(JSON.stringify(quarantines)).byteLength > 2 * 1_024 * 1_024
  ) {
    throw new Error('Receipt recovery metadata exceeds the bounded migration budget.');
  }

  await transaction.table('receipts').clear();
  if (retainedReceipts.length) await transaction.table('receipts').bulkPut(retainedReceipts);
  if (tombstones.length) await transaction.table('receiptTombstones').bulkPut(tombstones);
  if (quarantines.length) await transaction.table('quarantines').bulkPut(quarantines);
}
