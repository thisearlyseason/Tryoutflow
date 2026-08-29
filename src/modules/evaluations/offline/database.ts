import Dexie, { type EntityTable } from 'dexie';

import type { EvaluationSyncState } from './sync-state';

export const EVALUATION_OFFLINE_DATABASE_VERSION = 2;
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
  leaseOwner?: string;
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
  serverVersion: number;
  acknowledgedAt: string;
  expiresAt: string;
};

export type StoredSessionContext = {
  scopeKey: string;
  scope: EvaluationStorageScope;
  userId: string;
  tryoutNumber: number | null;
  categories: {
    id: string;
    scaleMin: 1;
    scaleMax: 5 | 10;
    required: boolean;
  }[];
  expiresAt: string;
};

type IndexedDbFactory = IDBFactory;

export class EvaluationOfflineDatabase extends Dexie {
  sessionContexts!: EntityTable<StoredSessionContext, 'scopeKey'>;
  drafts!: EntityTable<StoredEvaluationDraft, 'scopeKey'>;
  mutations!: EntityTable<StoredEvaluationMutation, 'storageKey'>;
  receipts!: EntityTable<StoredEvaluationReceipt, 'storageKey'>;

  constructor(name: string, indexedDb: IndexedDbFactory, keyRange: typeof IDBKeyRange) {
    super(name, { indexedDB: indexedDb, IDBKeyRange: keyRange });

    this.version(1).stores({
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations: '&storageKey,&clientMutationId,scopeKey,status,createdAt,nextAttemptAt',
    });

    this.version(EVALUATION_OFFLINE_DATABASE_VERSION)
      .stores({
        sessionContexts: '&scopeKey,userId,expiresAt',
        drafts: '&scopeKey,updatedAt,expiresAt',
        mutations:
          '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
        receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
      })
      .upgrade(async (transaction) => {
        const now = new Date().toISOString();
        const mutations = transaction.table('mutations');
        const records = (await mutations.toArray()) as Partial<StoredEvaluationMutation>[];
        for (const record of records) {
          const draft = record.draft ?? { scores: [], noteTagIds: [], flags: [] };
          record.payloadDigest ??= await Dexie.waitFor(
            digestValue({
              evaluationId: record.evaluationId,
              expectedVersion: record.expectedVersion,
              draft,
              scope: record.scope,
            }),
          );
          record.syncState =
            record.status === 'needs_attention' ? 'needs_attention' : 'saved_device';
          record.updatedAt = record.updatedAt ?? record.createdAt ?? now;
          record.attemptCount = record.attemptCount ?? 0;
          record.nextAttemptAt = record.nextAttemptAt ?? record.createdAt ?? now;
          await mutations.put(record);
        }
      });
  }
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

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`;
}

/** A stable integrity/idempotency digest; it is not used as encryption. */
export async function digestValue(value: unknown): Promise<string> {
  const source = canonicalize(value);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
