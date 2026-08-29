import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { z } from 'zod';

import { evaluationSyncStates, type EvaluationSyncState } from './sync-state';

export const EVALUATION_OFFLINE_DATABASE_VERSION = 3;
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
  errorCategory?: string;
  lastError?: string;
  acknowledgedAt?: string;
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

export type QuarantineSource = 'sessionContexts' | 'drafts' | 'mutations' | 'receipts';
export type QuarantineReason =
  'invalid_record' | 'digest_mismatch' | 'physical_key_collision' | 'user_mismatch';

export type StoredEvaluationQuarantine = {
  quarantineKey: string;
  scopeKey?: string;
  sourceTable: QuarantineSource;
  sourceKey: string;
  reason: QuarantineReason;
  diagnostic: string;
  status: 'needs_attention';
  createdAt: string;
  originalRecord: unknown;
};

const uuid = z.uuid();
const isoDate = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

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
  note: z.string().max(4_000).optional(),
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
    errorCategory: z.string().min(1).max(80).optional(),
    lastError: z.string().max(500).optional(),
    acknowledgedAt: isoDate.optional(),
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
  });

export const storedQuarantineSchema = z.strictObject({
  quarantineKey: uuid,
  scopeKey: z.string().min(1).max(512).optional(),
  sourceTable: z.enum(['sessionContexts', 'drafts', 'mutations', 'receipts']),
  sourceKey: z.string().max(600),
  reason: z.enum(['invalid_record', 'digest_mismatch', 'physical_key_collision', 'user_mismatch']),
  diagnostic: z.string().min(1).max(500),
  status: z.literal('needs_attention'),
  createdAt: isoDate,
  originalRecord: z.unknown(),
});

type IndexedDbFactory = IDBFactory;

export class EvaluationOfflineDatabase extends Dexie {
  sessionContexts!: EntityTable<StoredSessionContext, 'scopeKey'>;
  drafts!: EntityTable<StoredEvaluationDraft, 'scopeKey'>;
  mutations!: EntityTable<StoredEvaluationMutation, 'storageKey'>;
  receipts!: EntityTable<StoredEvaluationReceipt, 'storageKey'>;
  quarantines!: EntityTable<StoredEvaluationQuarantine, 'quarantineKey'>;

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

    this.version(EVALUATION_OFFLINE_DATABASE_VERSION)
      .stores({
        sessionContexts: '&scopeKey,expiresAt',
        drafts: '&scopeKey,updatedAt,expiresAt',
        mutations:
          '&storageKey,&clientMutationId,scopeKey,queueKey,status,[scopeKey+status],createdAt,nextAttemptAt',
        receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
        quarantines: '&quarantineKey,scopeKey,sourceTable,status,createdAt',
      })
      .upgrade((transaction) => migrateToVersionThree(transaction, authenticatedUserId));
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

function sourceKey(sourceTable: QuarantineSource, record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const item = record as Record<string, unknown>;
  const candidate =
    sourceTable === 'mutations' || sourceTable === 'receipts'
      ? (item.storageKey ?? item.clientMutationId)
      : item.scopeKey;
  return typeof candidate === 'string' ? candidate.slice(0, 600) : '';
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
  return {
    quarantineKey: crypto.randomUUID(),
    ...(trustedScopeKey ? { scopeKey: trustedScopeKey } : {}),
    sourceTable,
    sourceKey: sourceKey(sourceTable, record),
    reason,
    diagnostic: diagnostic.slice(0, 500),
    status: 'needs_attention',
    createdAt: now,
    originalRecord: structuredClone(record),
  };
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
    else mutations.push(parsed.data);
  }

  for (const raw of rawByTable.get('receipts') ?? []) {
    const item = raw as Record<string, unknown>;
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

  for (const sourceTable of sourceTables) await transaction.table(sourceTable).clear();
  if (validContexts.length) await transaction.table('sessionContexts').bulkPut(validContexts);
  if (validDrafts.length) await transaction.table('drafts').bulkPut(validDrafts);
  if (validMutations.length) await transaction.table('mutations').bulkPut(validMutations);
  if (validReceipts.length) await transaction.table('receipts').bulkPut(validReceipts);
  if (quarantines.length) await transaction.table('quarantines').bulkPut(quarantines);
}
