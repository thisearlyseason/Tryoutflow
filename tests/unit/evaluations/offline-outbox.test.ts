import 'fake-indexeddb/auto';

import { createPrivateKey, sign } from 'node:crypto';

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authoritativeSnapshotProofClaims } from '../../../src/modules/evaluations/offline/authoritative-snapshot-proof';

import {
  digestValue,
  evaluationPayload,
  evaluationQueueKey,
  receiptTombstonePayload,
} from '../../../src/modules/evaluations/offline/database';

import {
  EvaluationOfflineError,
  bindEvaluationOfflineUser,
  createEvaluationOfflineRepository,
  enqueueEvaluationMutation,
  evaluationDatabaseName,
  listMutations,
  resetEvaluationOfflineUser,
  saveSessionContext,
  type EvaluationMutationInput,
  type EvaluationStorageScope,
} from '../../../src/modules/evaluations/offline/outbox';

const scope: EvaluationStorageScope = {
  userId: '10000000-0000-4000-8000-000000000001',
  evaluatorId: '10000000-0000-4000-8000-000000000002',
  organizationId: '10000000-0000-4000-8000-000000000003',
  tryoutId: '10000000-0000-4000-8000-000000000004',
  sessionId: '10000000-0000-4000-8000-000000000005',
  registrationId: '10000000-0000-4000-8000-000000000006',
  rubricVersionId: '10000000-0000-4000-8000-000000000007',
};

const otherScope: EvaluationStorageScope = {
  ...scope,
  userId: '20000000-0000-4000-8000-000000000001',
  evaluatorId: '20000000-0000-4000-8000-000000000002',
};

const secondEvaluationId = '30000000-0000-4000-8000-000000000010';
const draft = {
  scores: [{ categoryId: '40000000-0000-4000-8000-000000000001', value: 4 }],
  note: 'Private evaluator note',
  noteTagIds: ['40000000-0000-4000-8000-000000000002'],
  flags: ['needs_another_look'],
};

async function issueTestSnapshotProof(input: {
  scope: EvaluationStorageScope;
  evaluationId: string;
  version: number;
  draft: typeof draft;
  now: Date;
}) {
  const unsigned = {
    renderNonce: crypto.randomUUID(),
    scope: input.scope,
    evaluationId: input.evaluationId,
    version: input.version,
    draftDigest: await digestValue(input.draft),
    issuedAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + 120_000).toISOString(),
  };
  const privateJwk = JSON.parse(process.env.EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK!) as JsonWebKey;
  return {
    ...unsigned,
    signature: sign('sha256', authoritativeSnapshotProofClaims(unsigned), {
      key: createPrivateKey({ key: privateJwk, format: 'jwk' }),
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url'),
  };
}

type PublicConflictAction = Parameters<
  ReturnType<typeof createEvaluationOfflineRepository>['resolveConflict']
>[0]['action'];
const publicUseServerAction: PublicConflictAction = 'use_server';
// @ts-expect-error Automatic keep-local recovery is deliberately absent from the public API.
const publicKeepLocalAction: PublicConflictAction = 'keep_local';
void publicUseServerAction;
void publicKeepLocalAction;

declare const publicRepository: ReturnType<typeof createEvaluationOfflineRepository>;
declare const publicProof: Parameters<
  ReturnType<typeof createEvaluationOfflineRepository>['registerAuthoritativeSnapshotProof']
>[0];
declare const publicConflictInput: Parameters<
  ReturnType<typeof createEvaluationOfflineRepository>['resolveConflict']
>[0];
if (false) {
  // @ts-expect-error Public proof registration cannot accept caller-controlled time.
  void publicRepository.registerAuthoritativeSnapshotProof(publicProof, { now: new Date(0) });
  // @ts-expect-error Public destructive conflict input cannot accept caller-controlled time.
  void publicRepository.resolveConflict({ ...publicConflictInput, now: new Date(0) });
  // @ts-expect-error The authenticated module wrapper cannot swap the repository clock.
  bindEvaluationOfflineUser(scope.userId, { clock: { now: () => new Date(0) } });
}

const mutation = (
  overrides: Partial<EvaluationMutationInput> = {},
): EvaluationMutationInput & { clientMutationId: string } => ({
  scope,
  evaluationId: '30000000-0000-4000-8000-000000000001',
  clientMutationId: '30000000-0000-4000-8000-000000000002',
  expectedVersion: 2,
  draft,
  ...overrides,
});

const context = (targetScope = scope) => ({
  scope: targetScope,
  tryoutNumber: 42,
  categories: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      scaleMin: 1 as const,
      scaleMax: 5 as const,
      required: true,
    },
  ],
});

let databaseNames: string[] = [];
let sequence = 0;
const resolutionLocalLineage = new Map<string, { evaluationId: string; expectedVersion: number }>();

function databaseBase(label: string): string {
  return `tryoutflow-test-${label}-${sequence++}`;
}

function trackUserDatabase(baseName: string, userId = scope.userId): string {
  const name = evaluationDatabaseName(baseName, userId);
  databaseNames.push(name);
  return name;
}

function repository(label: string, userId = scope.userId, extra = {}) {
  const databaseName = databaseBase(label);
  trackUserDatabase(databaseName, userId);
  return createEvaluationOfflineRepository({ authenticatedUserId: userId, databaseName, ...extra });
}

function fakeClock(initial: Date) {
  let current = initial.getTime();
  return {
    clock: { now: () => new Date(current) },
    set(value: Date) {
      current = value.getTime();
    },
    advance(milliseconds: number) {
      current += milliseconds;
    },
  };
}

async function prepare(target: ReturnType<typeof repository>, targetScope = scope) {
  await target.saveSessionContext(context(targetScope));
  return target;
}

async function resolveVerified(
  target: ReturnType<typeof createEvaluationOfflineRepository>,
  input: object,
): Promise<{
  action: 'keep_local' | 'use_server';
  evaluationId: string;
  expectedVersion: number;
  draftDigest: string;
  payloadDigest?: string;
  clientMutationId?: string;
  queueSequence?: number;
}> {
  const resolution = input as {
    scope: EvaluationStorageScope;
    clientMutationId: string;
    local: typeof draft;
    server: {
      scope: EvaluationStorageScope;
      evaluationId: string;
      version: number;
      draft: typeof draft;
    };
    now?: Date;
  };
  const durable = await target.loadDraft(resolution.scope);
  const rows = await target.listMutations(resolution.scope);
  const newest = rows
    .slice()
    .sort((left, right) => left.queueSequence - right.queueSequence)
    .at(-1);
  const lineageKey = `${target.databaseName}|${resolution.clientMutationId}`;
  const localLineage = newest
    ? { evaluationId: newest.evaluationId, expectedVersion: newest.expectedVersion }
    : (resolutionLocalLineage.get(lineageKey) ??
      (durable?.evaluationId
        ? { evaluationId: durable.evaluationId, expectedVersion: durable.expectedVersion }
        : null));
  if (localLineage) resolutionLocalLineage.set(lineageKey, localLineage);
  const issuedAt = resolution.now ?? new Date();
  const proof = await issueTestSnapshotProof({
    scope: resolution.server.scope,
    evaluationId: resolution.server.evaluationId,
    version: resolution.server.version,
    draft: resolution.server.draft,
    now: issuedAt,
  });
  if (!durable && newest) {
    await target.saveDraftLocally({
      scope: resolution.scope,
      evaluationId: newest.evaluationId,
      expectedVersion: newest.expectedVersion,
      draft: newest.draft,
    });
  }
  await target.registerAuthoritativeSnapshotProof(proof);
  return target.resolveConflict({
    ...input,
    local: {
      evaluationId: localLineage?.evaluationId ?? null,
      expectedVersion: localLineage?.expectedVersion ?? 0,
      draft: resolution.local,
    },
    snapshotProofNonce: proof.renderNonce,
  } as never) as Promise<{
    action: 'keep_local' | 'use_server';
    evaluationId: string;
    expectedVersion: number;
    draftDigest: string;
    payloadDigest?: string;
    clientMutationId?: string;
    queueSequence?: number;
  }>;
}

async function prepareConflictAfterAcknowledgedPredecessor(label: string) {
  const issuedAt = new Date('2026-08-29T19:00:00.000Z');
  const time = fakeClock(issuedAt);
  const baseName = databaseBase(label);
  const physicalName = trackUserDatabase(baseName);
  const target = await prepare(
    createEvaluationOfflineRepository(
      { authenticatedUserId: scope.userId, databaseName: baseName },
      time.clock,
    ),
  );
  const predecessorId = '30000000-0000-4000-8000-000000000230';
  await target.saveDraftAndEnqueueMutation(mutation({ clientMutationId: predecessorId }), {
    now: issuedAt,
  });
  const predecessor = (await target.nextPendingMutation(scope, { now: issuedAt }))!;
  await target.acknowledgeMutation({
    scope,
    evaluationId: predecessor.evaluationId,
    clientMutationId: predecessorId,
    claimToken: predecessor.claimToken!,
    expectedVersion: predecessor.expectedVersion,
    payloadDigest: predecessor.payloadDigest,
    serverVersion: predecessor.expectedVersion + 1,
    acknowledgedAt: '2026-08-29T19:00:01.000Z',
    now: new Date('2026-08-29T19:00:01.000Z'),
  });

  const clientMutationId = '30000000-0000-4000-8000-000000000231';
  const localDraft = { ...draft, note: 'newest conflicted local bytes' };
  await target.saveDraftAndEnqueueMutation(
    mutation({
      clientMutationId,
      expectedVersion: 3,
      draft: localDraft,
    }),
    { now: new Date('2026-08-29T19:00:02.000Z') },
  );
  const head = (await target.nextPendingMutation(scope, {
    now: new Date('2026-08-29T19:00:02.000Z'),
  }))!;
  await target.markNeedsAttention({
    scope,
    evaluationId: head.evaluationId,
    clientMutationId,
    claimToken: head.claimToken!,
    category: 'conflict',
    message: 'server advanced',
    conflictServerEvaluationId: head.evaluationId,
    conflictServerVersion: 7,
    now: new Date('2026-08-29T19:00:03.000Z'),
  });
  const serverDraft = { ...draft, note: 'authoritative server bytes' };
  const proof = await issueTestSnapshotProof({
    scope,
    evaluationId: head.evaluationId,
    version: 7,
    draft: serverDraft,
    now: issuedAt,
  });
  await target.registerAuthoritativeSnapshotProof(proof);
  return {
    target,
    physicalName,
    predecessor,
    predecessorStorageKey: `${Object.values(scope).join('|')}|${predecessorId}`,
    input: {
      scope,
      clientMutationId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: {
        evaluationId: head.evaluationId,
        expectedVersion: head.expectedVersion,
        draft: localDraft,
      },
      server: { scope, evaluationId: head.evaluationId, version: 7, draft: serverDraft },
      snapshotProofNonce: proof.renderNonce,
    },
  };
}

const validTerminalStateCells = new Set([
  'pending|false|absent',
  'leased|false|absent',
  'needs_attention|false|absent',
  'acknowledged|true|receipt_authority',
]);

const terminalStateMatrix = (
  ['pending', 'leased', 'needs_attention', 'acknowledged'] as const
).flatMap((status) =>
  ([false, true] as const).flatMap((hasReceipt) =>
    (['absent', 'receipt_authority', 'wrong_reason', 'divergent'] as const).map((tombstone) => ({
      status,
      hasReceipt,
      tombstone,
      valid: validTerminalStateCells.has(`${status}|${hasReceipt}|${tombstone}`),
    })),
  ),
);

type TerminalStateCell = (typeof terminalStateMatrix)[number];

async function prepareTerminalStateCell(cell: TerminalStateCell, suffix: string) {
  const { status, hasReceipt, tombstone } = cell;
  const scenario = await prepareConflictAfterAcknowledgedPredecessor(
    `terminal-matrix-${suffix}-${status}-${hasReceipt}-${tombstone}`,
  );
  const successorId = '30000000-0000-4000-8000-000000000235';
  const successorDraft = { ...draft, note: 'terminal matrix connected successor' };
  const successor = await scenario.target.saveDraftAndEnqueueMutation(
    mutation({ clientMutationId: successorId, expectedVersion: 4, draft: successorDraft }),
    { now: new Date('2026-08-29T19:00:04.000Z') },
  );
  const successorStorageKey = `${Object.values(scope).join('|')}|${successorId}`;
  const acknowledgedAt = '2026-08-29T19:00:05.000Z';
  const claimToken = '30000000-0000-4000-8000-000000000236';
  const statusFields =
    status === 'pending'
      ? { status, syncState: 'saved_device' }
      : status === 'leased'
        ? {
            status,
            syncState: 'syncing',
            claimToken,
            leaseUntil: '2026-08-29T19:02:00.000Z',
          }
        : status === 'needs_attention'
          ? {
              status,
              syncState: 'needs_attention',
              errorCategory: 'server',
              lastError: 'bounded terminal-state matrix probe',
            }
          : { status, syncState: 'synced', acknowledgedAt };
  const receiptPayload = {
    storageKey: successorStorageKey,
    clientMutationId: successorId,
    scopeKey: Object.values(scope).join('|'),
    scope,
    evaluationId: successor.mutation.evaluationId,
    expectedVersion: successor.mutation.expectedVersion,
    payloadDigest: successor.mutation.payloadDigest,
    claimToken,
    serverVersion: successor.mutation.expectedVersion + 1,
    acknowledgedAt,
    expiresAt: '2026-09-29T19:00:05.000Z',
  };
  const exactAuthorityPayload = {
    storageKey: successorStorageKey,
    scopeKey: Object.values(scope).join('|'),
    clientMutationId: successorId,
    reason: 'receipt_authority' as const,
    createdAt: acknowledgedAt,
    evaluationId: successor.mutation.evaluationId,
    expectedVersion: successor.mutation.expectedVersion,
    payloadDigest: successor.mutation.payloadDigest,
    serverVersion: successor.mutation.expectedVersion + 1,
    acknowledgedAt,
  };
  const raw = new Dexie(scenario.physicalName);
  raw.version(5).stores(v5Stores);
  await raw.open();
  await raw.table('mutations').put({ ...successor.mutation, ...statusFields });
  if (hasReceipt)
    await raw.table('receipts').put({
      ...receiptPayload,
      receiptDigest: await digestValue(receiptPayload),
    });
  if (tombstone !== 'absent') {
    const tombstonePayload =
      tombstone === 'receipt_authority'
        ? exactAuthorityPayload
        : tombstone === 'wrong_reason'
          ? {
              storageKey: successorStorageKey,
              scopeKey: Object.values(scope).join('|'),
              clientMutationId: successorId,
              reason: 'corrupt_receipt' as const,
              createdAt: acknowledgedAt,
            }
          : {
              ...exactAuthorityPayload,
              expectedVersion: exactAuthorityPayload.expectedVersion + 1,
            };
    await raw.table('receiptTombstones').put({
      ...tombstonePayload,
      tombstoneDigest: await digestValue(receiptTombstonePayload(tombstonePayload)),
    });
  }
  const before = await snapshotV5(raw, { includeProof: true });
  raw.close();
  return {
    scenario,
    successor,
    before,
    resolutionInput: {
      ...scenario.input,
      local: {
        evaluationId: successor.mutation.evaluationId,
        expectedVersion: successor.mutation.expectedVersion,
        draft: successorDraft,
      },
    },
    acknowledgment: {
      scope,
      evaluationId: successor.mutation.evaluationId,
      clientMutationId: successorId,
      claimToken,
      expectedVersion: successor.mutation.expectedVersion,
      payloadDigest: successor.mutation.payloadDigest,
      serverVersion: successor.mutation.expectedVersion + 1,
      acknowledgedAt,
      now: new Date('2026-08-29T19:00:06.000Z'),
    },
  };
}

const v3Stores = {
  sessionContexts: '&scopeKey,expiresAt',
  drafts: '&scopeKey,updatedAt,expiresAt',
  mutations:
    '&storageKey,&clientMutationId,scopeKey,queueKey,status,[scopeKey+status],createdAt,nextAttemptAt',
  receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
  quarantines: '&quarantineKey,scopeKey,sourceTable,status,createdAt',
};

const v4Stores = {
  sessionContexts: '&scopeKey,expiresAt',
  drafts: '&scopeKey,updatedAt,expiresAt',
  mutations:
    '&storageKey,&clientMutationId,scopeKey,queueKey,[queueKey+queueSequence],status,[scopeKey+status],createdAt,nextAttemptAt',
  receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
  quarantines: '&quarantineKey,scopeKey,sourceTable,status,createdAt',
  queueCounters: '&queueKey,scopeKey,nextSequence',
};

const v5Stores = {
  ...v4Stores,
  receiptTombstones: '&storageKey,scopeKey,createdAt',
};

async function snapshotV5(database: Dexie, options: { includeProof?: boolean } = {}) {
  return Promise.all(
    Object.keys(v5Stores).map(async (tableName) => {
      const table = database.table(tableName);
      const keys = await table.toCollection().primaryKeys();
      const values = await table.bulkGet(keys);
      const normalizedValues =
        tableName === 'sessionContexts' && !options.includeProof
          ? values.map((value) => {
              if (!value || typeof value !== 'object') return value;
              const { authoritativeSnapshotProof: _proof, ...rest } = value as Record<
                string,
                unknown
              >;
              return rest;
            })
          : values;
      return [
        tableName,
        keys.map((key, index) => [key, undefined] as const),
        normalizedValues,
      ] as const;
    }),
  );
}

beforeEach(() => {
  databaseNames = [];
  resolutionLocalLineage.clear();
  resetEvaluationOfflineUser();
});

afterEach(async () => {
  resetEvaluationOfflineUser();
  await Promise.all([...new Set(databaseNames)].map((name) => Dexie.delete(name)));
});

describe('evaluation offline outbox', () => {
  it('commits the draft and its outbox lineage atomically', async () => {
    const target = await prepare(
      repository('atomic-draft-outbox', scope.userId, { quotas: { maxMutations: 0 } }),
    );

    await expect(
      target.saveDraftAndEnqueueMutation({
        scope,
        evaluationId: mutation().evaluationId,
        expectedVersion: 2,
        draft,
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded', quota: 'mutations' });

    expect(await target.loadDraft(scope)).toBeNull();
    expect(await target.listMutations(scope)).toEqual([]);
    target.close();
  });

  it('repairs a legacy saved-device draft with no outbox lineage without claiming server authority', async () => {
    const target = await prepare(repository('repair-missing-draft-lineage'));
    await target.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
    });

    const repaired = await target.reconcileDraftLineage(scope);

    expect(repaired).toMatchObject({ state: 'saved_device', repaired: true });
    expect(repaired.mutation).toMatchObject({
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      payloadDigest: repaired.draft?.payloadDigest,
      status: 'pending',
    });
    expect(await target.getReceipt(scope, repaired.mutation!.clientMutationId)).toBeNull();
    target.close();
  });

  it('binds hydration to the exact evaluation when two queues both have sequence one', async () => {
    const target = await prepare(repository('hydrate-two-sequence-one-queues'));
    const firstEvaluationId = mutation().evaluationId;
    const secondDraft = { ...draft, note: 'second provisional evaluation' };
    await target.enqueueEvaluationMutation(mutation());
    await target.saveDraftLocally({
      scope,
      evaluationId: secondEvaluationId,
      expectedVersion: 2,
      draft: secondDraft,
    });
    const second = await target.enqueueEvaluationMutation(
      mutation({
        clientMutationId: '30000000-0000-4000-8000-000000000084',
        evaluationId: secondEvaluationId,
        draft: secondDraft,
      }),
    );

    const lineage = await target.reconcileDraftLineage(scope);

    expect((await target.listMutations(scope)).map((row) => row.queueSequence)).toEqual([1, 1]);
    expect(lineage.mutation).toMatchObject({
      clientMutationId: second.clientMutationId,
      evaluationId: secondEvaluationId,
      queueSequence: 1,
      draft: { note: 'second provisional evaluation' },
    });
    expect(lineage.mutation?.evaluationId).not.toBe(firstEvaluationId);
    target.close();
  });

  it('never promotes or replays a synced draft whose exact durable receipt lineage is absent', async () => {
    const baseName = databaseBase('missing-synced-lineage');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    await target.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 3,
      draft,
    });
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('drafts').update(Object.values(scope).join('|'), { syncState: 'synced' });
    raw.close();

    const recovered = await target.reconcileDraftLineage(scope);

    expect(recovered).toMatchObject({ state: 'needs_attention', repaired: false });
    expect(recovered).not.toHaveProperty('receipt');
    expect(await target.listMutations(scope)).toEqual([]);
    expect(await target.loadDraft(scope)).toMatchObject({ syncState: 'needs_attention', draft });
    target.close();
  });

  it('hydrates exact server authority from the permanent receipt marker after compaction', async () => {
    const baseName = databaseBase('compacted-draft-lineage');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const saved = await target.saveDraftAndEnqueueMutation(
      {
        ...mutation(),
        expectedVersion: 2,
      },
      { now: new Date('2026-08-29T10:00:00.000Z') },
    );
    const claimed = await target.nextPendingMutation(scope, {
      now: new Date('2026-08-29T10:00:00.000Z'),
    });
    await target.acknowledgeMutation({
      scope,
      evaluationId: claimed!.evaluationId,
      clientMutationId: claimed!.clientMutationId,
      claimToken: claimed!.claimToken!,
      expectedVersion: claimed!.expectedVersion,
      payloadDigest: claimed!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:01.000Z',
      now: new Date('2026-08-29T10:00:01.000Z'),
    });
    await target.clearAcknowledged(scope);
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw
      .table('receipts')
      .delete(`${Object.values(scope).join('|')}|${claimed!.clientMutationId}`);
    raw.close();

    const lineage = await target.reconcileDraftLineage(scope);

    expect(saved.mutation.clientMutationId).toBe(claimed!.clientMutationId);
    expect(lineage).toMatchObject({
      state: 'synced',
      repaired: false,
      confirmation: {
        clientMutationId: claimed!.clientMutationId,
        evaluationId: claimed!.evaluationId,
        serverVersion: 3,
        payloadDigest: claimed!.payloadDigest,
      },
    });
    target.close();
  });

  it('physically partitions databases and denies cross-user scopes at every API boundary', async () => {
    const baseName = databaseBase('physical-user-isolation');
    trackUserDatabase(baseName, scope.userId);
    trackUserDatabase(baseName, otherScope.userId);
    const first = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const second = createEvaluationOfflineRepository({
      authenticatedUserId: otherScope.userId,
      databaseName: baseName,
    });
    await prepare(first);
    await first.enqueueEvaluationMutation(mutation());

    expect(first.databaseName).not.toBe(second.databaseName);
    await expect(second.listMutations(scope)).rejects.toMatchObject({ code: 'user_mismatch' });
    await expect(
      second.enqueueEvaluationMutation(
        mutation({
          scope,
          clientMutationId: '30000000-0000-4000-8000-000000000020',
        }),
      ),
    ).rejects.toMatchObject({ code: 'user_mismatch' });
    await expect(second.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'user_mismatch',
    });
    expect(await second.listMutations(otherScope)).toEqual([]);
    first.close();
    second.close();
  });

  it('closes and rotates the module repository when the authenticated user changes', async () => {
    const baseName = databaseBase('auth-rotation');
    trackUserDatabase(baseName, scope.userId);
    trackUserDatabase(baseName, otherScope.userId);
    bindEvaluationOfflineUser(scope.userId, { databaseName: baseName });
    await saveSessionContext(context());
    await enqueueEvaluationMutation(mutation());

    bindEvaluationOfflineUser(otherScope.userId, { databaseName: baseName });
    await expect(listMutations(scope)).rejects.toMatchObject({ code: 'user_mismatch' });
    expect(await listMutations(otherScope)).toEqual([]);
  });

  it('persists and validates a digest-bound draft across close and reopen', async () => {
    const baseName = databaseBase('reopen');
    const physicalName = trackUserDatabase(baseName);
    const first = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(first);
    await first.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
    });
    first.close();

    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.loadDraft(scope)).resolves.toMatchObject({
      expectedVersion: 2,
      draft: { note: 'Private evaluator note' },
    });
    reopened.close();

    const raw = new Dexie(physicalName);
    raw.version(3).stores(v3Stores);
    await raw.open();
    await raw.table('drafts').update(Object.values(scope).join('|'), { expectedVersion: 99 });
    raw.close();

    const corrupted = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(corrupted.loadDraft(scope)).rejects.toMatchObject({ code: 'corrupt_record' });
    expect(await corrupted.listQuarantines(scope)).toEqual([
      expect.objectContaining({ sourceTable: 'drafts', status: 'needs_attention' }),
    ]);
    corrupted.close();
  });

  it('commits before saved-device notification and isolates callback failures from storage errors', async () => {
    const target = await prepare(repository('callbacks'));
    const states: string[] = [];
    const callbackErrors: unknown[] = [];
    await expect(
      target.saveDraftLocally(
        { scope, evaluationId: mutation().evaluationId, expectedVersion: 2, draft },
        {
          onSyncState: (state) => {
            states.push(state);
            throw new Error(`consumer failed at ${state}`);
          },
          onCallbackError: (error) => callbackErrors.push(error),
        },
      ),
    ).resolves.toMatchObject({ syncState: 'saved_device' });
    expect(states).toEqual(['saving_local', 'saved_device']);
    expect(callbackErrors).toHaveLength(2);
    expect(await target.loadDraft(scope)).not.toBeNull();
    target.close();
  });

  it('strictly validates bounded context and drafts against the exact stored rubric', async () => {
    const target = repository('validation');
    await expect(
      target.saveSessionContext({ ...context(), unexpected: 'field' } as never),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      target.saveSessionContext({
        ...context(),
        categories: [context().categories[0]!, context().categories[0]!],
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await target.saveSessionContext(context());
    await expect(
      target.saveDraftLocally({
        scope,
        evaluationId: mutation().evaluationId,
        expectedVersion: 2,
        draft: { ...draft, scores: [{ categoryId: crypto.randomUUID(), value: 4 }] },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      target.enqueueEvaluationMutation(
        mutation({ draft: { ...draft, scores: [draft.scores[0]!, draft.scores[0]!] } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      target.enqueueEvaluationMutation(
        mutation({ draft: { ...draft, scores: [{ ...draft.scores[0]!, value: 6 }] } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    target.close();
  });

  it('enforces typed per-user quotas while preserving existing unacknowledged work', async () => {
    const target = repository('quota', scope.userId, {
      quotas: { maxMutations: 1, maxUnacknowledgedMutations: 1 },
    });
    await prepare(target);
    await target.enqueueEvaluationMutation(mutation());
    await expect(
      target.enqueueEvaluationMutation(
        mutation({ clientMutationId: '30000000-0000-4000-8000-000000000021' }),
      ),
    ).rejects.toMatchObject({ code: 'quota_exceeded', quota: 'mutations' });
    expect(await target.listMutations(scope)).toHaveLength(1);
    target.close();
  });

  it('issues random fencing tokens and acknowledges only an exact unexpired leased payload', async () => {
    const target = await prepare(repository('ack-fence'));
    await target.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
    });
    await target.enqueueEvaluationMutation(mutation(), {
      now: new Date('2026-08-29T10:00:00.000Z'),
    });
    const claim = await target.nextPendingMutation(scope, {
      now: new Date('2026-08-29T10:00:01.000Z'),
      leaseDurationMs: 30_000,
    });
    expect(claim).toMatchObject({ status: 'leased', syncState: 'syncing' });
    expect(claim?.claimToken).toMatch(/^[0-9a-f-]{36}$/);

    const acknowledgment = {
      scope,
      clientMutationId: mutation().clientMutationId,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      payloadDigest: claim!.payloadDigest,
      claimToken: claim!.claimToken!,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:02.000Z',
      now: new Date('2026-08-29T10:00:02.000Z'),
    };
    await expect(
      target.acknowledgeMutation({ ...acknowledgment, claimToken: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'lease_mismatch' });
    const receipt = await target.acknowledgeMutation(acknowledgment);
    receipt.serverVersion = 999;
    expect((await target.getReceipt(scope, mutation().clientMutationId))?.serverVersion).toBe(3);
    await expect(target.acknowledgeMutation(acknowledgment)).resolves.toMatchObject({
      serverVersion: 3,
    });
    await expect(
      target.acknowledgeMutation({ ...acknowledgment, serverVersion: 4 }),
    ).rejects.toMatchObject({ code: 'receipt_mismatch' });
    await expect(
      target.markNeedsAttention({
        scope,
        evaluationId: mutation().evaluationId,
        clientMutationId: mutation().clientMutationId,
        claimToken: claim!.claimToken!,
        category: 'conflict',
        message: 'late conflict',
        now: new Date('2026-08-29T10:00:03.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(target.getSyncState(scope)).resolves.toBe('synced');
    target.close();
  });

  it('rejects stale workers after exact expired-lease reclaim and rejects transitions after expiry', async () => {
    const target = await prepare(repository('stale-worker'));
    await target.enqueueEvaluationMutation(mutation(), {
      now: new Date('2026-08-29T10:00:00.000Z'),
    });
    const first = await target.nextPendingMutation(scope, {
      now: new Date('2026-08-29T10:00:01.000Z'),
      leaseDurationMs: 1_000,
    });
    const reclaimed = await target.nextPendingMutation(scope, {
      now: new Date('2026-08-29T10:00:02.001Z'),
      leaseDurationMs: 1_000,
    });
    expect(reclaimed?.claimToken).not.toBe(first?.claimToken);
    await expect(
      target.recordMutationFailure({
        scope,
        evaluationId: mutation().evaluationId,
        clientMutationId: mutation().clientMutationId,
        claimToken: first!.claimToken!,
        category: 'network',
        message: 'stale worker',
        now: new Date('2026-08-29T10:00:02.500Z'),
      }),
    ).rejects.toMatchObject({ code: 'lease_mismatch' });
    await expect(
      target.recordMutationFailure({
        scope,
        evaluationId: mutation().evaluationId,
        clientMutationId: mutation().clientMutationId,
        claimToken: reclaimed!.claimToken!,
        category: 'network',
        message: 'too late',
        now: new Date('2026-08-29T10:00:03.002Z'),
      }),
    ).rejects.toMatchObject({ code: 'lease_expired' });
    target.close();
  });

  it('preserves FIFO per evaluation while allowing another evaluation queue to progress', async () => {
    const target = await prepare(repository('fifo'));
    await target.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000031' }),
      { now: new Date('2026-08-29T10:00:00.000Z') },
    );
    await target.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000032', expectedVersion: 3 }),
      { now: new Date('2026-08-29T10:00:01.000Z') },
    );
    await target.enqueueEvaluationMutation(
      mutation({
        clientMutationId: '30000000-0000-4000-8000-000000000033',
        evaluationId: secondEvaluationId,
      }),
      { now: new Date('2026-08-29T10:00:02.000Z') },
    );
    const firstQueue = await target.nextPendingMutation(scope, {
      now: new Date('2026-08-29T10:01:00.000Z'),
    });
    const otherQueue = await target.nextPendingMutation(scope, {
      now: new Date('2026-08-29T10:01:00.000Z'),
    });
    expect(firstQueue?.clientMutationId).toBe('30000000-0000-4000-8000-000000000031');
    expect(otherQueue?.clientMutationId).toBe('30000000-0000-4000-8000-000000000033');
    expect(
      (await target.listMutations(scope)).find(
        (item) => item.clientMutationId === '30000000-0000-4000-8000-000000000032',
      )?.status,
    ).toBe('pending');
    target.close();
  });

  it('blocks successors behind attention until explicit resolution', async () => {
    const target = await prepare(repository('fifo-blockers'));
    await target.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000041' }),
    );
    await target.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000042', expectedVersion: 3 }),
    );
    const head = await target.nextPendingMutation(scope);
    await target.markNeedsAttention({
      scope,
      evaluationId: head!.evaluationId,
      clientMutationId: head!.clientMutationId,
      claimToken: head!.claimToken!,
      category: 'conflict',
      message: 'version conflict',
    });
    expect(await target.nextPendingMutation(scope)).toBeNull();
    await target.resolveNeedsAttention({
      scope,
      evaluationId: head!.evaluationId,
      clientMutationId: head!.clientMutationId,
      action: 'retry',
    });
    expect((await target.nextPendingMutation(scope))?.clientMutationId).toBe(
      '30000000-0000-4000-8000-000000000041',
    );
    target.close();
  });

  it('rejects deferred keep-local recovery before changing durable state', async () => {
    const target = await prepare(repository('keep-local-deferred'));
    const clientMutationId = '30000000-0000-4000-8000-000000000211';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'server changed',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 3,
    });
    const before = await target.listMutations(scope);
    await expect(
      resolveVerified(target, {
        scope,
        clientMutationId,
        action: 'keep_local',
        original: {
          evaluationId: head.evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: { ...draft, note: 'export this exact draft' },
        server: { scope, evaluationId: head.evaluationId, version: 3, draft },
        verification: { online: true, fresh: true },
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(await target.listMutations(scope)).toEqual(before);
    target.close();
  });

  it('requires an exact unexpired server-render proof instead of caller freshness booleans', async () => {
    const issuedAt = new Date('2026-08-29T12:00:00.000Z');
    const time = fakeClock(issuedAt);
    const baseName = databaseBase('use-server-provenance');
    trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository(
        { authenticatedUserId: scope.userId, databaseName: baseName },
        time.clock,
      ),
    );
    const clientMutationId = '30000000-0000-4000-8000-000000000212';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'server changed',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 3,
    });
    await target.saveDraftLocally({
      scope,
      evaluationId: head.evaluationId,
      expectedVersion: head.expectedVersion,
      draft: head.draft,
    });
    const input = {
      scope,
      clientMutationId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: { evaluationId: head.evaluationId, expectedVersion: head.expectedVersion, draft },
      server: { scope, evaluationId: head.evaluationId, version: 3, draft },
      snapshotProofNonce: crypto.randomUUID(),
    };
    await expect(
      target.resolveConflict({
        ...input,
        ...({ verification: { online: true, fresh: true } } as object),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const expiredProof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 3,
      draft,
      now: issuedAt,
    });
    await expect(
      target.registerAuthoritativeSnapshotProof({
        ...expiredProof,
        renderNonce: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    await target.registerAuthoritativeSnapshotProof(expiredProof);
    time.advance(120_001);
    await expect(
      target.resolveConflict({
        ...input,
        snapshotProofNonce: expiredProof.renderNonce,
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    const freshAt = new Date(issuedAt.getTime() + 180_000);
    time.set(freshAt);
    const freshProof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 3,
      draft,
      now: freshAt,
    });
    await target.registerAuthoritativeSnapshotProof(freshProof);
    await expect(
      target.resolveConflict({
        ...input,
        snapshotProofNonce: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(
      target.resolveConflict({
        ...input,
        server: { ...input.server, draft: { ...draft, note: 'changed server body' } },
        snapshotProofNonce: freshProof.renderNonce,
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(
      target.resolveConflict({
        ...input,
        snapshotProofNonce: freshProof.renderNonce,
      }),
    ).resolves.toMatchObject({ action: 'use_server' });
    target.close();
  });

  it('uses its construction-time clock and rejects caller time before proof storage or discard', async () => {
    const issuedAt = new Date('2026-08-29T12:00:00.000Z');
    const time = fakeClock(issuedAt);
    const baseName = databaseBase('repository-owned-proof-clock');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository(
      { authenticatedUserId: scope.userId, databaseName: baseName },
      time.clock,
    );
    await prepare(target);
    const clientMutationId = '30000000-0000-4000-8000-000000000225';
    await target.saveDraftAndEnqueueMutation(mutation({ clientMutationId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'clock authority',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 7,
    });
    const serverDraft = { ...draft, note: 'clock-authoritative server' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 7,
      draft: serverDraft,
      now: issuedAt,
    });
    await target.registerAuthoritativeSnapshotProof(proof);
    time.advance(120_001);
    time.clock.now = () => new Date(issuedAt);

    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();
    const input = {
      scope,
      clientMutationId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: { evaluationId: head.evaluationId, expectedVersion: head.expectedVersion, draft },
      server: { scope, evaluationId: head.evaluationId, version: 7, draft: serverDraft },
      snapshotProofNonce: proof.renderNonce,
    };
    await expect(target.resolveConflict(input)).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    await expect(
      target.resolveConflict({ ...input, now: issuedAt } as never),
    ).rejects.toMatchObject({ code: 'invalid_input' });

    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    const storedContext = await after.table('sessionContexts').get(Object.values(scope).join('|'));
    expect(storedContext.authoritativeSnapshotProof).not.toHaveProperty('consumedAt');
    after.close();

    const lateProof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 8,
      draft: serverDraft,
      now: issuedAt,
    });
    await expect(target.registerAuthoritativeSnapshotProof(lateProof)).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    target.close();
  });

  it('accepts the exact future-skew boundary and rejects one millisecond beyond it', async () => {
    const clockAt = new Date('2026-08-29T12:00:00.000Z');
    const exactTime = fakeClock(clockAt);
    const exact = await prepare(
      createEvaluationOfflineRepository(
        {
          authenticatedUserId: scope.userId,
          databaseName: databaseBase('proof-clock-skew-exact'),
        },
        exactTime.clock,
      ),
    );
    databaseNames.push(exact.databaseName);
    const exactProof = await issueTestSnapshotProof({
      scope,
      evaluationId: mutation().evaluationId,
      version: 3,
      draft,
      now: new Date(clockAt.getTime() + 5_000),
    });
    await expect(exact.registerAuthoritativeSnapshotProof(exactProof)).resolves.toBeUndefined();
    exact.close();

    const beyondTime = fakeClock(clockAt);
    const beyond = await prepare(
      createEvaluationOfflineRepository(
        {
          authenticatedUserId: scope.userId,
          databaseName: databaseBase('proof-clock-skew-beyond'),
        },
        beyondTime.clock,
      ),
    );
    databaseNames.push(beyond.databaseName);
    const beyondProof = await issueTestSnapshotProof({
      scope,
      evaluationId: mutation().evaluationId,
      version: 3,
      draft,
      now: new Date(clockAt.getTime() + 5_001),
    });
    await expect(beyond.registerAuthoritativeSnapshotProof(beyondProof)).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    beyond.close();
  });

  it('rechecks proof expiry after verification and immediately before destructive writes', async () => {
    const issuedAt = new Date('2026-08-29T12:00:00.000Z');
    let phase: 'setup' | 'resolve' = 'setup';
    let resolutionReads = 0;
    const clock = {
      now: () => {
        if (phase === 'setup') return new Date(issuedAt);
        resolutionReads += 1;
        return new Date(issuedAt.getTime() + (resolutionReads === 1 ? 60_000 : 120_001));
      },
    };
    const baseName = databaseBase('proof-expires-during-resolution');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository(
      { authenticatedUserId: scope.userId, databaseName: baseName },
      clock,
    );
    await prepare(target);
    const clientMutationId = '30000000-0000-4000-8000-000000000228';
    await target.saveDraftAndEnqueueMutation(mutation({ clientMutationId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'proof crosses expiry in transaction',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 7,
    });
    const serverDraft = { ...draft, note: 'server while proof expires' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 7,
      draft: serverDraft,
      now: issuedAt,
    });
    await target.registerAuthoritativeSnapshotProof(proof);
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();
    phase = 'resolve';
    await expect(
      target.resolveConflict({
        scope,
        clientMutationId,
        action: 'use_server',
        original: {
          evaluationId: head.evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: { evaluationId: head.evaluationId, expectedVersion: head.expectedVersion, draft },
        server: { scope, evaluationId: head.evaluationId, version: 7, draft: serverDraft },
        snapshotProofNonce: proof.renderNonce,
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(resolutionReads).toBeGreaterThan(1);
    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    after.close();
    target.close();
  });

  it('does not register a proof that expires while the final quota scan is awaiting IndexedDB', async () => {
    const issuedAt = new Date('2026-08-29T12:00:00.000Z');
    const time = fakeClock(issuedAt);
    let phase: 'setup' | 'register' = 'setup';
    const clock = {
      now: time.clock.now,
      async beforeByteQuota() {
        if (phase === 'register') {
          await Promise.resolve();
          time.advance(120_001);
        }
      },
    };
    const baseName = databaseBase('proof-expires-during-registration-quota');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository(
        { authenticatedUserId: scope.userId, databaseName: baseName },
        clock,
      ),
    );
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId: mutation().evaluationId,
      version: 3,
      draft,
      now: issuedAt,
    });

    phase = 'register';
    await expect(target.registerAuthoritativeSnapshotProof(proof)).rejects.toMatchObject({
      code: 'invalid_transition',
    });

    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const storedContext = await raw.table('sessionContexts').get(Object.values(scope).join('|'));
    expect(storedContext).not.toHaveProperty('authoritativeSnapshotProof');
    raw.close();
    target.close();
  });

  it('rolls back destructive recovery when its proof expires during the last quota phase', async () => {
    const issuedAt = new Date('2026-08-29T19:00:00.000Z');
    const time = fakeClock(issuedAt);
    let phase: 'setup' | 'resolve' = 'setup';
    let advanced = false;
    const clock = {
      now: time.clock.now,
      async beforeByteQuota() {
        if (phase === 'resolve' && !advanced) {
          await Promise.resolve();
          advanced = true;
          time.advance(120_001);
        }
      },
    };
    const baseName = databaseBase('proof-expires-during-resolution-quota');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository(
        { authenticatedUserId: scope.userId, databaseName: baseName },
        clock,
      ),
    );
    const clientMutationId = '30000000-0000-4000-8000-000000000232';
    await target.saveDraftAndEnqueueMutation(mutation({ clientMutationId }), { now: issuedAt });
    const head = (await target.nextPendingMutation(scope, { now: issuedAt }))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'proof expires in quota phase',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 7,
      now: new Date('2026-08-29T19:00:01.000Z'),
    });
    const serverDraft = { ...draft, note: 'server quota-race bytes' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 7,
      draft: serverDraft,
      now: issuedAt,
    });
    await target.registerAuthoritativeSnapshotProof(proof);
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();

    phase = 'resolve';
    await expect(
      target.resolveConflict({
        scope,
        clientMutationId,
        action: 'use_server',
        original: {
          evaluationId: head.evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: {
          evaluationId: head.evaluationId,
          expectedVersion: head.expectedVersion,
          draft,
        },
        server: { scope, evaluationId: head.evaluationId, version: 7, draft: serverDraft },
        snapshotProofNonce: proof.renderNonce,
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(advanced).toBe(true);
    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    const storedContext = await after.table('sessionContexts').get(Object.values(scope).join('|'));
    expect(storedContext.authoritativeSnapshotProof).not.toHaveProperty('consumedAt');
    after.close();
    target.close();
  });

  it('rejects a conflict-head receipt without its exact terminal authority fence byte-equivalently', async () => {
    const issuedAt = new Date('2026-08-29T12:00:00.000Z');
    const time = fakeClock(issuedAt);
    const baseName = databaseBase('use-server-terminal-triple');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository(
        { authenticatedUserId: scope.userId, databaseName: baseName },
        time.clock,
      ),
    );
    const clientMutationId = '30000000-0000-4000-8000-000000000229';
    await target.saveDraftAndEnqueueMutation(mutation({ clientMutationId }));
    const claimed = (await target.nextPendingMutation(scope))!;
    const claimToken = claimed.claimToken!;
    await target.markNeedsAttention({
      scope,
      evaluationId: claimed.evaluationId,
      clientMutationId,
      claimToken,
      category: 'conflict',
      message: 'receipt without authority fence',
      conflictServerEvaluationId: claimed.evaluationId,
      conflictServerVersion: 7,
    });
    const serverDraft = { ...draft, note: 'authoritative server bytes' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId: claimed.evaluationId,
      version: 7,
      draft: serverDraft,
      now: issuedAt,
    });
    await target.registerAuthoritativeSnapshotProof(proof);

    const storageKey = `${Object.values(scope).join('|')}|${clientMutationId}`;
    const acknowledgedAt = '2026-08-29T12:00:01.000Z';
    const receiptWithoutDigest = {
      storageKey,
      clientMutationId,
      scopeKey: Object.values(scope).join('|'),
      scope,
      evaluationId: claimed.evaluationId,
      expectedVersion: claimed.expectedVersion,
      payloadDigest: claimed.payloadDigest,
      claimToken,
      serverVersion: claimed.expectedVersion + 1,
      acknowledgedAt,
      expiresAt: '2026-09-29T12:00:01.000Z',
    };
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('receipts').put({
      ...receiptWithoutDigest,
      receiptDigest: await digestValue(receiptWithoutDigest),
    });
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();

    await expect(
      target.resolveConflict({
        scope,
        clientMutationId,
        action: 'use_server',
        original: {
          evaluationId: claimed.evaluationId,
          payloadDigest: claimed.payloadDigest,
          queueSequence: claimed.queueSequence,
        },
        local: {
          evaluationId: claimed.evaluationId,
          expectedVersion: claimed.expectedVersion,
          draft,
        },
        server: { scope, evaluationId: claimed.evaluationId, version: 7, draft: serverDraft },
        snapshotProofNonce: proof.renderNonce,
      }),
    ).rejects.toMatchObject({ code: 'corrupt_record' });

    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    after.close();
    target.close();
  });

  it.each(['pending', 'leased', 'needs_attention'] as const)(
    'rejects a connected %s successor with an authority fence but no receipt before resolution or append',
    async (status) => {
      const scenario = await prepareConflictAfterAcknowledgedPredecessor(
        `use-server-authority-without-receipt-${status}`,
      );
      const successorId = '30000000-0000-4000-8000-000000000233';
      const successorDraft = { ...draft, note: `connected ${status} successor` };
      const successor = await scenario.target.saveDraftAndEnqueueMutation(
        mutation({ clientMutationId: successorId, expectedVersion: 4, draft: successorDraft }),
        { now: new Date('2026-08-29T19:00:04.000Z') },
      );
      const successorStorageKey = `${Object.values(scope).join('|')}|${successorId}`;
      const raw = new Dexie(scenario.physicalName);
      raw.version(5).stores(v5Stores);
      await raw.open();
      const statusFields =
        status === 'pending'
          ? { status, syncState: 'saved_device' }
          : status === 'leased'
            ? {
                status,
                syncState: 'syncing',
                claimToken: '30000000-0000-4000-8000-000000000234',
                leaseUntil: '2026-08-29T19:02:00.000Z',
              }
            : {
                status,
                syncState: 'needs_attention',
                errorCategory: 'server',
                lastError: 'bounded terminal-state matrix probe',
              };
      await raw.table('mutations').update(successorStorageKey, statusFields);
      const authorityPayload = {
        storageKey: successorStorageKey,
        scopeKey: Object.values(scope).join('|'),
        clientMutationId: successorId,
        reason: 'receipt_authority' as const,
        createdAt: '2026-08-29T19:00:05.000Z',
        evaluationId: successor.mutation.evaluationId,
        expectedVersion: successor.mutation.expectedVersion,
        payloadDigest: successor.mutation.payloadDigest,
        serverVersion: successor.mutation.expectedVersion + 1,
        acknowledgedAt: '2026-08-29T19:00:05.000Z',
      };
      await raw.table('receiptTombstones').put({
        ...authorityPayload,
        tombstoneDigest: await digestValue(receiptTombstonePayload(authorityPayload)),
      });
      const before = await snapshotV5(raw, { includeProof: true });
      raw.close();

      const resolutionInput = {
        ...scenario.input,
        local: {
          evaluationId: successor.mutation.evaluationId,
          expectedVersion: successor.mutation.expectedVersion,
          draft: successorDraft,
        },
      };

      await expect(scenario.target.resolveConflict(resolutionInput)).rejects.toMatchObject({
        code: 'corrupt_record',
      });
      await expect(
        scenario.target.saveDraftAndEnqueueMutation(
          mutation({ clientMutationId: successorId, expectedVersion: 4, draft: successorDraft }),
          { now: new Date('2026-08-29T19:00:06.000Z') },
        ),
      ).rejects.toMatchObject({ code: 'corrupt_record' });

      const after = new Dexie(scenario.physicalName);
      after.version(5).stores(v5Stores);
      await after.open();
      expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
      after.close();
      scenario.target.close();
    },
  );

  it.each(terminalStateMatrix)(
    'classifies terminal matrix status=$status receipt=$hasReceipt tombstone=$tombstone',
    async (cell) => {
      const { valid } = cell;
      const { scenario, before } = await prepareTerminalStateCell(cell, 'append');

      const append = scenario.target.saveDraftAndEnqueueMutation(
        mutation({
          clientMutationId: '30000000-0000-4000-8000-000000000237',
          expectedVersion: 5,
          draft: { ...draft, note: 'future append after terminal matrix' },
        }),
        { now: new Date('2026-08-29T19:00:06.000Z') },
      );
      if (valid) {
        await expect(append).resolves.toMatchObject({ mutation: { status: 'pending' } });
      } else {
        await expect(append).rejects.toMatchObject({ code: 'corrupt_record' });
        const after = new Dexie(scenario.physicalName);
        after.version(5).stores(v5Stores);
        await after.open();
        expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
        after.close();
      }
      scenario.target.close();
    },
  );

  it.each(terminalStateMatrix)(
    'classifies claim matrix status=$status receipt=$hasReceipt tombstone=$tombstone',
    async (cell) => {
      const { scenario, before } = await prepareTerminalStateCell(cell, 'claim');
      const claim = scenario.target.nextPendingMutation(scope, {
        now: new Date('2026-08-29T19:00:06.000Z'),
      });
      if (!cell.valid) {
        await expect(claim).rejects.toMatchObject({ code: 'corrupt_record' });
        const after = new Dexie(scenario.physicalName);
        after.version(5).stores(v5Stores);
        await after.open();
        expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
        after.close();
      } else {
        // The prepared natural lineage has an earlier conflict head, so every structurally valid
        // successor is correctly non-claimable after it passes terminal-state classification.
        await expect(claim).resolves.toBeNull();
      }
      scenario.target.close();
    },
  );

  it.each(terminalStateMatrix)(
    'classifies acknowledgment matrix status=$status receipt=$hasReceipt tombstone=$tombstone',
    async (cell) => {
      const { scenario, before, acknowledgment } = await prepareTerminalStateCell(cell, 'ack');
      const replay = scenario.target.acknowledgeMutation(acknowledgment);
      if (!cell.valid) {
        await expect(replay).rejects.toMatchObject({ code: 'corrupt_record' });
        const after = new Dexie(scenario.physicalName);
        after.version(5).stores(v5Stores);
        await after.open();
        expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
        after.close();
      } else if (cell.status === 'leased' || cell.status === 'acknowledged') {
        await expect(replay).resolves.toMatchObject({ syncState: 'synced' });
      } else {
        await expect(replay).rejects.toMatchObject({ code: 'lease_mismatch' });
        const after = new Dexie(scenario.physicalName);
        after.version(5).stores(v5Stores);
        await after.open();
        expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
        after.close();
      }
      scenario.target.close();
    },
  );

  it.each(terminalStateMatrix)(
    'classifies use-server matrix status=$status receipt=$hasReceipt tombstone=$tombstone',
    async (cell) => {
      const { scenario, before, resolutionInput } = await prepareTerminalStateCell(
        cell,
        'use-server',
      );
      const resolution = scenario.target.resolveConflict(resolutionInput);
      if (cell.valid) {
        // A valid terminal cell reaches the ordinary conflict/draft/FIFO rules. Artificial leased
        // and acknowledged successor fixtures may be rejected there, but never by terminal-state
        // classification.
        try {
          await expect(resolution).resolves.toMatchObject({ action: 'use_server' });
        } catch (error) {
          expect(String(error)).not.toContain('Nonterminal work cannot carry');
          expect(String(error)).not.toContain('exact acknowledged mutation and terminal authority');
        }
      } else {
        await expect(resolution).rejects.toMatchObject({ code: 'corrupt_record' });
        const after = new Dexie(scenario.physicalName);
        after.version(5).stores(v5Stores);
        await after.open();
        expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
        after.close();
      }
      scenario.target.close();
    },
  );

  it.each([
    ['acknowledged live triple', false],
    ['compacted receipt and authority fence', true],
  ] as const)(
    'accepts an exact %s before destructive server recovery',
    async (_label, compacted) => {
      const scenario = await prepareConflictAfterAcknowledgedPredecessor(
        `use-server-valid-terminal-${compacted ? 'compacted' : 'live'}`,
      );
      if (compacted) {
        const raw = new Dexie(scenario.physicalName);
        raw.version(5).stores(v5Stores);
        await raw.open();
        await raw.table('mutations').delete(scenario.predecessorStorageKey);
        raw.close();
      }

      await expect(scenario.target.resolveConflict(scenario.input)).resolves.toMatchObject({
        action: 'use_server',
        expectedVersion: 7,
      });
      scenario.target.close();
    },
  );

  it.each(['pending', 'leased'] as const)(
    'rejects a %s mutation that falsely carries a receipt and authority fence',
    async (status) => {
      const scenario = await prepareConflictAfterAcknowledgedPredecessor(
        `use-server-nonterminal-triple-${status}`,
      );
      const raw = new Dexie(scenario.physicalName);
      raw.version(5).stores(v5Stores);
      await raw.open();
      const mutationChanges =
        status === 'pending'
          ? {
              status,
              syncState: 'saved_device',
              acknowledgedAt: undefined,
            }
          : {
              status,
              syncState: 'syncing',
              acknowledgedAt: undefined,
              claimToken: crypto.randomUUID(),
              leaseUntil: '2026-08-29T19:01:00.000Z',
            };
      await raw.table('mutations').update(scenario.predecessorStorageKey, mutationChanges);
      const before = await snapshotV5(raw, { includeProof: true });
      raw.close();

      await expect(scenario.target.resolveConflict(scenario.input)).rejects.toMatchObject({
        code: 'corrupt_record',
      });
      const after = new Dexie(scenario.physicalName);
      after.version(5).stores(v5Stores);
      await after.open();
      expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
      after.close();
      scenario.target.close();
    },
  );

  it('rejects a receipt with a wrong-reason fence before live resolution or exact replay', async () => {
    const live = await prepareConflictAfterAcknowledgedPredecessor(
      'use-server-wrong-receipt-fence-live',
    );
    const corruptLive = new Dexie(live.physicalName);
    corruptLive.version(5).stores(v5Stores);
    await corruptLive.open();
    const liveFence = await corruptLive.table('receiptTombstones').get(live.predecessorStorageKey);
    const { tombstoneDigest: _liveDigest, ...liveFencePayload } = liveFence;
    const wrongLivePayload = {
      storageKey: liveFencePayload.storageKey,
      scopeKey: liveFencePayload.scopeKey,
      clientMutationId: liveFencePayload.clientMutationId,
      reason: 'corrupt_receipt',
      createdAt: liveFencePayload.createdAt,
    };
    await corruptLive.table('receiptTombstones').put({
      ...wrongLivePayload,
      tombstoneDigest: await digestValue(receiptTombstonePayload(wrongLivePayload as never)),
    });
    const liveBefore = await snapshotV5(corruptLive, { includeProof: true });
    corruptLive.close();
    await expect(live.target.resolveConflict(live.input)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    const liveAfter = new Dexie(live.physicalName);
    liveAfter.version(5).stores(v5Stores);
    await liveAfter.open();
    expect(await snapshotV5(liveAfter, { includeProof: true })).toEqual(liveBefore);
    liveAfter.close();
    live.target.close();

    const replay = await prepareConflictAfterAcknowledgedPredecessor(
      'use-server-wrong-receipt-fence-replay',
    );
    await replay.target.resolveConflict(replay.input);
    const corruptReplay = new Dexie(replay.physicalName);
    corruptReplay.version(5).stores(v5Stores);
    await corruptReplay.open();
    const replayFence = await corruptReplay
      .table('receiptTombstones')
      .get(replay.predecessorStorageKey);
    const { tombstoneDigest: _replayDigest, ...replayFencePayload } = replayFence;
    const wrongReplayPayload = {
      storageKey: replayFencePayload.storageKey,
      scopeKey: replayFencePayload.scopeKey,
      clientMutationId: replayFencePayload.clientMutationId,
      reason: 'corrupt_receipt',
      createdAt: replayFencePayload.createdAt,
    };
    await corruptReplay.table('receiptTombstones').put({
      ...wrongReplayPayload,
      tombstoneDigest: await digestValue(receiptTombstonePayload(wrongReplayPayload as never)),
    });
    const replayBefore = await snapshotV5(corruptReplay, { includeProof: true });
    corruptReplay.close();
    await expect(replay.target.resolveConflict(replay.input)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    const replayAfter = new Dexie(replay.physicalName);
    replayAfter.version(5).stores(v5Stores);
    await replayAfter.open();
    expect(await snapshotV5(replayAfter, { includeProof: true })).toEqual(replayBefore);
    replayAfter.close();
    replay.target.close();
  });

  it('rejects a digest-valid client-ID collision that points its receipt triple at another evaluation', async () => {
    const scenario = await prepareConflictAfterAcknowledgedPredecessor(
      'use-server-terminal-client-id-collision',
    );
    const raw = new Dexie(scenario.physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const receipt = await raw.table('receipts').get(scenario.predecessorStorageKey);
    const { receiptDigest: _receiptDigest, ...receiptPayload } = receipt;
    const collidedReceipt = { ...receiptPayload, evaluationId: secondEvaluationId };
    await raw.table('receipts').put({
      ...collidedReceipt,
      receiptDigest: await digestValue(collidedReceipt),
    });
    const fence = await raw.table('receiptTombstones').get(scenario.predecessorStorageKey);
    const { tombstoneDigest: _tombstoneDigest, ...fencePayload } = fence;
    const collidedFence = { ...fencePayload, evaluationId: secondEvaluationId };
    await raw.table('receiptTombstones').put({
      ...collidedFence,
      tombstoneDigest: await digestValue(receiptTombstonePayload(collidedFence)),
    });
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();

    await expect(scenario.target.resolveConflict(scenario.input)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    const after = new Dexie(scenario.physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    after.close();
    scenario.target.close();
  });

  it('requires the exact stored queue-tail draft before consuming a destructive proof', async () => {
    const issuedAt = new Date('2026-08-29T12:00:00.000Z');
    const time = fakeClock(issuedAt);
    const baseName = databaseBase('use-server-required-draft');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository(
      { authenticatedUserId: scope.userId, databaseName: baseName },
      time.clock,
    );
    await prepare(target);
    const clientMutationId = '30000000-0000-4000-8000-000000000226';
    await target.saveDraftAndEnqueueMutation(mutation({ clientMutationId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'missing local authority',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 7,
    });
    const serverDraft = { ...draft, note: 'authoritative replacement' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 7,
      draft: serverDraft,
      now: issuedAt,
    });
    await target.registerAuthoritativeSnapshotProof(proof);

    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const exactDraft = await raw.table('drafts').get(Object.values(scope).join('|'));
    await raw.table('drafts').delete(Object.values(scope).join('|'));
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();
    const input = {
      scope,
      clientMutationId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: { evaluationId: head.evaluationId, expectedVersion: head.expectedVersion, draft },
      server: { scope, evaluationId: head.evaluationId, version: 7, draft: serverDraft },
      snapshotProofNonce: proof.renderNonce,
    };
    await expect(target.resolveConflict(input)).rejects.toMatchObject({ code: 'corrupt_record' });
    const afterReject = new Dexie(physicalName);
    afterReject.version(5).stores(v5Stores);
    await afterReject.open();
    expect(await snapshotV5(afterReject, { includeProof: true })).toEqual(before);
    await afterReject.table('drafts').put(exactDraft);
    afterReject.close();

    await expect(target.resolveConflict(input)).resolves.toMatchObject({
      action: 'use_server',
      evaluationId: head.evaluationId,
      expectedVersion: 7,
    });
    const resolvedRaw = new Dexie(physicalName);
    resolvedRaw.version(5).stores(v5Stores);
    await resolvedRaw.open();
    const resolvedDraft = await resolvedRaw.table('drafts').get(Object.values(scope).join('|'));
    await resolvedRaw.table('drafts').delete(Object.values(scope).join('|'));
    const replayBefore = await snapshotV5(resolvedRaw, { includeProof: true });
    resolvedRaw.close();
    await expect(target.resolveConflict(input)).rejects.toMatchObject({ code: 'corrupt_record' });
    const replayAfter = new Dexie(physicalName);
    replayAfter.version(5).stores(v5Stores);
    await replayAfter.open();
    expect(await snapshotV5(replayAfter, { includeProof: true })).toEqual(replayBefore);
    await replayAfter.table('drafts').put(resolvedDraft);
    replayAfter.close();
    await expect(target.resolveConflict(input)).resolves.toMatchObject({ action: 'use_server' });
    target.close();
  });

  it('serializes scope teardown with destructive resolution without a missing-draft gap', async () => {
    const baseName = databaseBase('use-server-teardown-serialization');
    trackUserDatabase(baseName);
    const first = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const second = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const clientMutationId = '30000000-0000-4000-8000-000000000227';
    await first.saveDraftAndEnqueueMutation(mutation({ clientMutationId }));
    const head = (await first.nextPendingMutation(scope))!;
    await first.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'teardown serialization',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 7,
    });
    const serverDraft = { ...draft, note: 'serialized server authority' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId: head.evaluationId,
      version: 7,
      draft: serverDraft,
      now: new Date(),
    });
    await first.registerAuthoritativeSnapshotProof(proof);
    const input = {
      scope,
      clientMutationId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: { evaluationId: head.evaluationId, expectedVersion: head.expectedVersion, draft },
      server: { scope, evaluationId: head.evaluationId, version: 7, draft: serverDraft },
      snapshotProofNonce: proof.renderNonce,
    };
    const [resolved, tornDown] = await Promise.all([
      first.resolveConflict(input),
      second.teardownScope(scope),
    ]);
    expect(resolved).toMatchObject({ action: 'use_server', expectedVersion: 7 });
    expect(tornDown).toMatchObject({ cleared: false });
    await expect(first.loadDraft(scope)).resolves.toMatchObject({
      evaluationId: head.evaluationId,
      expectedVersion: 7,
      draft: { note: serverDraft.note },
    });
    first.close();
    second.close();
  });

  it('rejects a stale use-server dialog after a sibling durably appends newer local work', async () => {
    const baseName = databaseBase('use-server-newest-durable-authority');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const evaluationId = mutation().evaluationId;
    const firstId = '30000000-0000-4000-8000-000000000221';
    const secondId = '30000000-0000-4000-8000-000000000222';
    const newerDraft = { ...draft, note: 'newest sibling edit' };
    await target.saveDraftAndEnqueueMutation(
      mutation({ clientMutationId: firstId, evaluationId, expectedVersion: 2, draft }),
    );
    await target.saveDraftAndEnqueueMutation(
      mutation({ clientMutationId: secondId, evaluationId, expectedVersion: 3, draft: newerDraft }),
    );
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId,
      clientMutationId: firstId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'sibling append won',
      conflictServerEvaluationId: evaluationId,
      conflictServerVersion: 7,
    });
    const now = new Date();
    const serverDraft = { ...draft, note: 'authoritative server' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId,
      version: 7,
      draft: serverDraft,
      now,
    });
    await target.registerAuthoritativeSnapshotProof(proof);
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();
    const common = {
      scope,
      clientMutationId: firstId,
      action: 'use_server' as const,
      original: {
        evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      server: { scope, evaluationId, version: 7, draft: serverDraft },
      snapshotProofNonce: proof.renderNonce,
    };
    await expect(
      target.resolveConflict({
        ...common,
        local: { evaluationId, expectedVersion: 2, draft },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const afterReject = new Dexie(physicalName);
    afterReject.version(5).stores(v5Stores);
    await afterReject.open();
    expect(await snapshotV5(afterReject, { includeProof: true })).toEqual(before);
    afterReject.close();
    await expect(
      target.resolveConflict({
        ...common,
        local: { evaluationId, expectedVersion: 3, draft: newerDraft },
      }),
    ).resolves.toMatchObject({ action: 'use_server', evaluationId });
    target.close();
  });

  it('serializes a concurrent append and use-server without discarding the append winner', async () => {
    const baseName = databaseBase('use-server-concurrent-append');
    trackUserDatabase(baseName);
    const first = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const second = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const evaluationId = mutation().evaluationId;
    const firstId = '30000000-0000-4000-8000-000000000223';
    await first.saveDraftAndEnqueueMutation(
      mutation({ clientMutationId: firstId, evaluationId, expectedVersion: 2, draft }),
    );
    const head = (await first.nextPendingMutation(scope))!;
    await first.markNeedsAttention({
      scope,
      evaluationId,
      clientMutationId: firstId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'concurrent append',
      conflictServerEvaluationId: evaluationId,
      conflictServerVersion: 7,
    });
    const now = new Date();
    const serverDraft = { ...draft, note: 'server winner' };
    const proof = await issueTestSnapshotProof({
      scope,
      evaluationId,
      version: 7,
      draft: serverDraft,
      now,
    });
    await first.registerAuthoritativeSnapshotProof(proof);
    const newerDraft = { ...draft, note: 'concurrent newer local append' };
    const [append, discard] = await Promise.allSettled([
      second.saveDraftAndEnqueueMutation(
        mutation({
          clientMutationId: '30000000-0000-4000-8000-000000000224',
          evaluationId,
          expectedVersion: 3,
          draft: newerDraft,
        }),
      ),
      first.resolveConflict({
        scope,
        clientMutationId: firstId,
        action: 'use_server',
        original: {
          evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: { evaluationId, expectedVersion: 2, draft },
        server: { scope, evaluationId, version: 7, draft: serverDraft },
        snapshotProofNonce: proof.renderNonce,
      }),
    ]);
    expect([append.status, discard.status]).toContain('fulfilled');
    const durable = await first.loadDraft(scope);
    if (append.status === 'fulfilled') {
      expect(durable).toMatchObject({ expectedVersion: 3, draft: { note: newerDraft.note } });
    } else {
      expect(discard.status).toBe('fulfilled');
      expect(durable).toMatchObject({ expectedVersion: 7, draft: { note: serverDraft.note } });
    }
    first.close();
    second.close();
  });

  it.each(['use_server'] as const)(
    'retains the complete three-entry terminal queue prefix for %s conflict resolution',
    async (action) => {
      const baseName = databaseBase(`conflict-dependent-terminal-prefix-${action}`);
      const physicalName = trackUserDatabase(baseName);
      const target = await prepare(
        createEvaluationOfflineRepository({
          authenticatedUserId: scope.userId,
          databaseName: baseName,
        }),
      );
      const ids = [
        '30000000-0000-4000-8000-000000000201',
        '30000000-0000-4000-8000-000000000202',
        '30000000-0000-4000-8000-000000000203',
      ];
      for (const [index, clientMutationId] of ids.entries())
        await target.enqueueEvaluationMutation(
          mutation({
            clientMutationId,
            expectedVersion: 2 + index,
            draft: { ...draft, note: `terminal prefix ${index + 1}` },
          }),
        );
      const head = (await target.nextPendingMutation(scope))!;
      await target.markNeedsAttention({
        scope,
        evaluationId: head.evaluationId,
        clientMutationId: head.clientMutationId,
        claimToken: head.claimToken!,
        category: 'conflict',
        message: 'three-entry terminal prefix',
        conflictServerEvaluationId: head.evaluationId,
        conflictServerVersion: 7,
      });
      const input = {
        scope,
        clientMutationId: head.clientMutationId,
        action,
        original: {
          evaluationId: head.evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: { ...draft, note: 'terminal prefix 3' },
        server: {
          scope,
          evaluationId: head.evaluationId,
          version: 7,
          draft: { ...draft, note: 'chosen server input' },
        },
      };
      const resolved = await resolveVerified(target, input);
      const raw = new Dexie(physicalName);
      raw.version(5).stores(v5Stores);
      await raw.open();
      const terminalRows = (await raw.table('receiptTombstones').toArray()).filter((row) =>
        ids.includes(row.clientMutationId),
      );
      expect(terminalRows).toHaveLength(3);
      expect(
        terminalRows
          .map((row) => ({
            clientMutationId: row.clientMutationId,
            queueKey: row.resolutionRetiredQueueKey,
            queueSequence: row.resolutionRetiredQueueSequence,
            expectedVersion: row.resolutionRetiredExpectedVersion,
            headMutationId: row.resolutionHeadMutationId,
            action: row.resolutionAction,
          }))
          .sort((left, right) => left.queueSequence - right.queueSequence),
      ).toEqual(
        ids.map((clientMutationId, index) => ({
          clientMutationId,
          queueKey: evaluationQueueKey(scope, head.evaluationId),
          queueSequence: index + 1,
          expectedVersion: 2 + index,
          headMutationId: ids[0],
          action,
        })),
      );
      raw.close();

      expect(await resolveVerified(target, input)).toEqual(resolved);
      const corrupt = new Dexie(physicalName);
      corrupt.version(5).stores(v5Stores);
      await corrupt.open();
      const removedTerminal = terminalRows.find((row) => row.clientMutationId === ids[2])!;
      await corrupt.table('receiptTombstones').delete(removedTerminal.storageKey);
      await corrupt.table('queueCounters').put({
        queueKey: evaluationQueueKey(scope, head.evaluationId),
        scopeKey: Object.values(scope).join('|'),
        nextSequence: 2,
      });
      const missingMemberSnapshot = await snapshotV5(corrupt);
      await expect(resolveVerified(target, input)).rejects.toMatchObject({
        code: 'corrupt_record',
      });
      expect(await snapshotV5(corrupt)).toEqual(missingMemberSnapshot);
      await corrupt.table('receiptTombstones').put(removedTerminal);
      for (const nextSequence of [2, 3]) {
        await corrupt.table('queueCounters').put({
          queueKey: evaluationQueueKey(scope, head.evaluationId),
          scopeKey: Object.values(scope).join('|'),
          nextSequence,
        });
        await expect(resolveVerified(target, input)).rejects.toMatchObject({
          code: 'corrupt_record',
        });
      }
      await corrupt.table('queueCounters').put({
        queueKey: evaluationQueueKey(scope, head.evaluationId),
        scopeKey: Object.values(scope).join('|'),
        nextSequence: 4,
      });
      corrupt.close();
      expect(await resolveVerified(target, input)).toEqual(resolved);
      await expect(
        target.enqueueEvaluationMutation(
          mutation({
            clientMutationId: '30000000-0000-4000-8000-000000000204',
            expectedVersion: 7,
            draft: { ...draft, note: 'future append after terminal prefix' },
          }),
        ),
      ).resolves.toMatchObject({ queueSequence: 4 });
      target.close();
    },
  );

  it('fails closed on a legacy bare dependent fence without reopening or reusing its sequence', async () => {
    const baseName = databaseBase('conflict-dependent-legacy-fence');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const headId = '30000000-0000-4000-8000-000000000211';
    const dependentId = '30000000-0000-4000-8000-000000000212';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: headId }));
    await target.enqueueEvaluationMutation(
      mutation({ clientMutationId: dependentId, expectedVersion: 3 }),
    );
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: headId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'legacy dependent fence',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 7,
    });
    const input = {
      scope,
      clientMutationId: headId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: head.evaluationId, version: 7, draft },
    };
    await resolveVerified(target, input);
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const dependent = await raw
      .table('receiptTombstones')
      .get(`${Object.values(scope).join('|')}|${dependentId}`);
    const legacy = { ...dependent };
    for (const key of [
      'resolutionId',
      'resolutionAction',
      'resolutionHeadMutationId',
      'resolutionInputDigest',
      'resolutionOutputDigest',
      'resolutionRetiredEvaluationId',
      'resolutionRetiredQueueKey',
      'resolutionRetiredQueueSequence',
      'resolutionRetiredExpectedVersion',
      'resolutionRetiredPayloadDigest',
      'resolutionRetiredDraftDigest',
    ])
      delete legacy[key];
    delete legacy.tombstoneDigest;
    legacy.tombstoneDigest = await digestValue(receiptTombstonePayload(legacy));
    await raw.table('receiptTombstones').put(legacy);
    raw.close();

    await expect(resolveVerified(target, input)).rejects.toMatchObject({ code: 'corrupt_record' });
    await expect(
      target.enqueueEvaluationMutation(
        mutation({
          clientMutationId: '30000000-0000-4000-8000-000000000213',
          expectedVersion: 7,
        }),
      ),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    await expect(
      target.enqueueEvaluationMutation(mutation({ clientMutationId: dependentId })),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    target.close();
  });

  it.each(['receipts', 'receiptTombstones'] as const)(
    'rejects an empty authoritative target with corrupt %s before changing the conflict',
    async (tableName) => {
      const baseName = databaseBase(`conflict-empty-target-${tableName}`);
      const physicalName = trackUserDatabase(baseName);
      const target = await prepare(
        createEvaluationOfflineRepository({
          authenticatedUserId: scope.userId,
          databaseName: baseName,
        }),
      );
      const originalId = '30000000-0000-4000-8000-000000000071';
      const corruptId = '30000000-0000-4000-8000-000000000072';
      const authoritativeId = '30000000-0000-4000-8000-000000000073';
      await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
      const head = await target.nextPendingMutation(scope);
      await target.markNeedsAttention({
        scope,
        evaluationId: head!.evaluationId,
        clientMutationId: originalId,
        claimToken: head!.claimToken!,
        category: 'conflict',
        message: 'empty target',
        conflictServerEvaluationId: authoritativeId,
        conflictServerVersion: 7,
      });
      await target.saveDraftLocally({
        scope,
        evaluationId: head!.evaluationId,
        expectedVersion: head!.expectedVersion,
        draft: head!.draft,
      });
      const raw = new Dexie(physicalName);
      raw.version(5).stores(v5Stores);
      await raw.open();
      await raw.table(tableName).put({
        storageKey: `${Object.values(scope).join('|')}|${corruptId}`,
        scopeKey: Object.values(scope).join('|'),
        clientMutationId: corruptId,
      });
      raw.close();

      await expect(
        resolveVerified(target, {
          scope,
          clientMutationId: originalId,
          action: 'use_server',
          original: {
            evaluationId: head!.evaluationId,
            payloadDigest: head!.payloadDigest,
            queueSequence: head!.queueSequence,
          },
          local: draft,
          server: { scope, evaluationId: authoritativeId, version: 7, draft },
        }),
      ).rejects.toMatchObject({ code: 'corrupt_record' });
      expect(await target.listMutations(scope)).toEqual([
        expect.objectContaining({ clientMutationId: originalId, status: 'needs_attention' }),
      ]);
      target.close();
    },
  );

  it.each(
    (['use_server'] as const).flatMap((action) =>
      (
        [
          ['sessionContexts', 'shadow-context', (key: unknown) => ({ scopeKey: key, scope })],
          ['drafts', 'shadow-draft', (key: unknown) => ({ scopeKey: key, scope })],
          [
            'mutations',
            new Date('2026-08-29T01:02:03.000Z'),
            (key: unknown) => ({ storageKey: key, scopeKey: 99, scope }),
          ],
          [
            'receipts',
            [scope.userId, 17],
            (key: unknown) => ({ storageKey: key, scopeKey: 99, scope }),
          ],
          ['receiptTombstones', 42, (key: unknown) => ({ storageKey: key, scopeKey: 99, scope })],
          [
            'queueCounters',
            [scope.userId, new Date('2026-08-29T01:02:03.000Z')],
            (key: unknown) => ({ queueKey: key, scopeKey: Object.values(scope).join('|') }),
          ],
          [
            'quarantines',
            new Date('2026-08-29T03:02:01.000Z'),
            (key: unknown) => ({
              quarantineKey: key,
              scopeKey: 99,
              recoveryEnvelope: { scopeKey: Object.values(scope).join('|') },
            }),
          ],
        ] as const
      ).map(
        ([tableName, physicalKey, rawRecord]) =>
          [action, tableName, physicalKey, rawRecord] as const,
      ),
    ),
  )(
    '%s fails closed on a target-attributable %s record hidden behind typed physical key %s',
    async (action, tableName, physicalKey, rawRecord) => {
      const baseName = databaseBase(`strict-union-${tableName}`);
      const physicalName = trackUserDatabase(baseName);
      const target = await prepare(
        createEvaluationOfflineRepository({
          authenticatedUserId: scope.userId,
          databaseName: baseName,
        }),
      );
      const originalId = crypto.randomUUID();
      const authoritativeId = crypto.randomUUID();
      await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
      const head = (await target.nextPendingMutation(scope))!;
      await target.markNeedsAttention({
        scope,
        evaluationId: head.evaluationId,
        clientMutationId: originalId,
        claimToken: head.claimToken!,
        category: 'conflict',
        message: 'strict physical union',
        conflictServerEvaluationId: authoritativeId,
        conflictServerVersion: 7,
      });
      await target.saveDraftLocally({
        scope,
        evaluationId: head.evaluationId,
        expectedVersion: head.expectedVersion,
        draft: head.draft,
      });
      const raw = new Dexie(physicalName);
      raw.version(5).stores(v5Stores);
      await raw.open();
      await raw.table(tableName).put(rawRecord(physicalKey));
      const beforeResolution = await snapshotV5(raw);
      raw.close();

      await expect(
        resolveVerified(target, {
          scope,
          clientMutationId: originalId,
          action,
          original: {
            evaluationId: head.evaluationId,
            payloadDigest: head.payloadDigest,
            queueSequence: head.queueSequence,
          },
          local: draft,
          server: { scope, evaluationId: authoritativeId, version: 7, draft },
        }),
      ).rejects.toMatchObject({ code: 'corrupt_record' });
      const after = new Dexie(physicalName);
      after.version(5).stores(v5Stores);
      await after.open();
      expect(await snapshotV5(after)).toEqual(beforeResolution);
      after.close();
      expect(await target.listMutations(scope)).toEqual([
        expect.objectContaining({ clientMutationId: originalId, status: 'needs_attention' }),
      ]);
      target.close();
    },
  );

  it('binds use-server replay to the exact explicitly discarded local draft', async () => {
    const target = await prepare(repository('conflict-use-server-local-input'));
    const originalId = crypto.randomUUID();
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: originalId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'exact local input',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 3,
    });
    const input = {
      scope,
      clientMutationId: originalId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: head.evaluationId, version: 3, draft },
    };
    const first = await resolveVerified(target, input);
    expect(await resolveVerified(target, input)).toEqual(first);
    const before = await target.loadDraft(scope);
    await expect(
      resolveVerified(target, {
        ...input,
        local: { ...draft, note: 'new edit after the original discard' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    expect(await target.loadDraft(scope)).toEqual(before);
    target.close();
  });

  it('does not let valid unrelated physical records block strict conflict append', async () => {
    const target = await prepare(repository('strict-union-unrelated'));
    const unrelatedScope = {
      ...scope,
      sessionId: crypto.randomUUID(),
      registrationId: crypto.randomUUID(),
    };
    await target.saveSessionContext(context(unrelatedScope));
    const originalId = crypto.randomUUID();
    const authoritativeId = crypto.randomUUID();
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: originalId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'unrelated physical scope',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 7,
    });
    await expect(
      resolveVerified(target, {
        scope,
        clientMutationId: originalId,
        action: 'use_server',
        original: {
          evaluationId: head.evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: draft,
        server: { scope, evaluationId: authoritativeId, version: 7, draft },
      }),
    ).resolves.toMatchObject({ evaluationId: authoritativeId });
    target.close();
  });

  it('accepts a valid compacted receipt-only authoritative target and continues its counter', async () => {
    const target = await prepare(repository('conflict-valid-compacted-target'));
    const originalId = '30000000-0000-4000-8000-000000000076';
    const priorTargetId = '30000000-0000-4000-8000-000000000077';
    const authoritativeId = '30000000-0000-4000-8000-000000000078';
    await target.enqueueEvaluationMutation(
      mutation({
        clientMutationId: priorTargetId,
        evaluationId: authoritativeId,
        expectedVersion: 7,
      }),
    );
    const priorTarget = await target.nextPendingMutation(scope);
    const acknowledgedAt = new Date(Date.parse(priorTarget!.updatedAt) + 1_000).toISOString();
    await target.acknowledgeMutation({
      scope,
      evaluationId: authoritativeId,
      clientMutationId: priorTargetId,
      claimToken: priorTarget!.claimToken!,
      expectedVersion: 7,
      payloadDigest: priorTarget!.payloadDigest,
      serverVersion: 8,
      acknowledgedAt,
      now: new Date(acknowledgedAt),
    });
    await target.clearAcknowledged(scope);
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = await target.nextPendingMutation(scope);
    await target.markNeedsAttention({
      scope,
      evaluationId: head!.evaluationId,
      clientMutationId: originalId,
      claimToken: head!.claimToken!,
      category: 'conflict',
      message: 'valid compacted target',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 8,
    });

    const resolved = await resolveVerified(target, {
      scope,
      clientMutationId: originalId,
      action: 'use_server',
      original: {
        evaluationId: head!.evaluationId,
        payloadDigest: head!.payloadDigest,
        queueSequence: head!.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: authoritativeId, version: 8, draft },
    });
    expect(resolved).toMatchObject({ evaluationId: authoritativeId, action: 'use_server' });
    expect(await target.getReceipt(scope, priorTargetId)).toMatchObject({ serverVersion: 8 });
    target.close();
  });

  it('rejects a corrupt empty target counter before creating a resolution fence', async () => {
    const baseName = databaseBase('conflict-empty-target-corrupt-counter');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const originalId = '30000000-0000-4000-8000-000000000079';
    const authoritativeId = '30000000-0000-4000-8000-000000000080';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = await target.nextPendingMutation(scope);
    await target.markNeedsAttention({
      scope,
      evaluationId: head!.evaluationId,
      clientMutationId: originalId,
      claimToken: head!.claimToken!,
      category: 'conflict',
      message: 'empty corrupt counter',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 7,
    });
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('queueCounters').put({
      queueKey: evaluationQueueKey(scope, authoritativeId),
      scopeKey: Object.values(scope).join('|'),
      nextSequence: 0,
    });
    raw.close();

    await expect(
      resolveVerified(target, {
        scope,
        clientMutationId: originalId,
        action: 'use_server',
        original: {
          evaluationId: head!.evaluationId,
          payloadDigest: head!.payloadDigest,
          queueSequence: head!.queueSequence,
        },
        local: draft,
        server: { scope, evaluationId: authoritativeId, version: 7, draft },
      }),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    expect(await target.listMutations(scope)).toEqual([
      expect.objectContaining({ clientMutationId: originalId, status: 'needs_attention' }),
    ]);
    target.close();
  });

  it('rejects an authoritative remap queue with an unproven sequence gap before retiring conflict', async () => {
    const baseName = databaseBase('conflict-target-lineage');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const originalId = '30000000-0000-4000-8000-000000000081';
    const targetMutationId = '30000000-0000-4000-8000-000000000082';
    const authoritativeId = '30000000-0000-4000-8000-000000000083';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = await target.nextPendingMutation(scope);
    await target.markNeedsAttention({
      scope,
      evaluationId: head!.evaluationId,
      clientMutationId: originalId,
      claimToken: head!.claimToken!,
      category: 'conflict',
      message: 'authoritative remap',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 7,
    });
    await target.enqueueEvaluationMutation(
      mutation({
        clientMutationId: targetMutationId,
        evaluationId: authoritativeId,
        expectedVersion: 7,
      }),
    );
    await target.saveDraftLocally({
      scope,
      evaluationId: authoritativeId,
      expectedVersion: 7,
      draft,
    });
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('queueCounters').update(evaluationQueueKey(scope, authoritativeId), {
      nextSequence: 9,
    });
    raw.close();

    await expect(
      resolveVerified(target, {
        scope,
        clientMutationId: originalId,
        action: 'use_server',
        original: {
          evaluationId: head!.evaluationId,
          payloadDigest: head!.payloadDigest,
          queueSequence: head!.queueSequence,
        },
        local: draft,
        server: { scope, evaluationId: authoritativeId, version: 7, draft },
      }),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    expect(await target.listMutations(scope)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientMutationId: originalId, status: 'needs_attention' }),
        expect.objectContaining({ clientMutationId: targetMutationId, status: 'pending' }),
      ]),
    );
    target.close();
  });

  it('rejects use-server when any related authoritative queue counter diverges and rolls back byte-exactly', async () => {
    const baseName = databaseBase('conflict-use-server-all-target-queues');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const originalId = '30000000-0000-4000-8000-000000000181';
    const targetMutationId = '30000000-0000-4000-8000-000000000182';
    const authoritativeId = '30000000-0000-4000-8000-000000000183';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: originalId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'authoritative queue relationship',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 7,
    });
    await target.enqueueEvaluationMutation(
      mutation({
        clientMutationId: targetMutationId,
        evaluationId: authoritativeId,
        expectedVersion: 7,
      }),
    );
    await target.saveDraftLocally({
      scope,
      evaluationId: authoritativeId,
      expectedVersion: 7,
      draft,
    });
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('queueCounters').update(evaluationQueueKey(scope, authoritativeId), {
      nextSequence: 9,
    });
    const before = JSON.stringify({
      draft: await raw.table('drafts').toArray(),
      mutations: await raw.table('mutations').toArray(),
      tombstones: await raw.table('receiptTombstones').toArray(),
      counters: await raw.table('queueCounters').toArray(),
    });
    raw.close();

    await expect(
      resolveVerified(target, {
        scope,
        clientMutationId: originalId,
        action: 'use_server',
        original: {
          evaluationId: head.evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: draft,
        server: { scope, evaluationId: authoritativeId, version: 7, draft },
      }),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    const reopenedRaw = new Dexie(physicalName);
    reopenedRaw.version(5).stores(v5Stores);
    await reopenedRaw.open();
    const after = JSON.stringify({
      draft: await reopenedRaw.table('drafts').toArray(),
      mutations: await reopenedRaw.table('mutations').toArray(),
      tombstones: await reopenedRaw.table('receiptTombstones').toArray(),
      counters: await reopenedRaw.table('queueCounters').toArray(),
    });
    expect(after).toBe(before);
    reopenedRaw.close();
    target.close();
  });

  it('rejects use-server replay when a related terminal-only queue counter becomes divergent', async () => {
    const baseName = databaseBase('conflict-use-server-replay-target-counter');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const originalId = '30000000-0000-4000-8000-000000000184';
    const authoritativeId = '30000000-0000-4000-8000-000000000185';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: originalId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'replay target counter',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 7,
    });
    const input = {
      scope,
      clientMutationId: originalId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: authoritativeId, version: 7, draft },
    };
    await expect(resolveVerified(target, input)).resolves.toMatchObject({ action: 'use_server' });
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('queueCounters').put({
      queueKey: evaluationQueueKey(scope, authoritativeId),
      scopeKey: Object.values(scope).join('|'),
      nextSequence: 9,
    });
    raw.close();
    await expect(resolveVerified(target, input)).rejects.toMatchObject({ code: 'corrupt_record' });
    target.close();
  });

  it('rejects use-server replay on an orphan related receipt while preserving the resolution snapshot', async () => {
    const baseName = databaseBase('conflict-use-server-replay-orphan-receipt');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const originalId = '30000000-0000-4000-8000-000000000186';
    const priorTargetId = '30000000-0000-4000-8000-000000000187';
    const authoritativeId = '30000000-0000-4000-8000-000000000188';
    await target.enqueueEvaluationMutation(
      mutation({
        clientMutationId: priorTargetId,
        evaluationId: authoritativeId,
        expectedVersion: 7,
      }),
    );
    const prior = (await target.nextPendingMutation(scope))!;
    const acknowledgedAt = new Date(Date.parse(prior.updatedAt) + 1_000).toISOString();
    await target.acknowledgeMutation({
      scope,
      evaluationId: authoritativeId,
      clientMutationId: priorTargetId,
      claimToken: prior.claimToken!,
      expectedVersion: 7,
      payloadDigest: prior.payloadDigest,
      serverVersion: 8,
      acknowledgedAt,
      now: new Date(acknowledgedAt),
    });
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: originalId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'orphan receipt replay',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 8,
    });
    const input = {
      scope,
      clientMutationId: originalId,
      action: 'use_server' as const,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: authoritativeId, version: 8, draft },
    };
    await resolveVerified(target, input);
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('mutations').delete(`${Object.values(scope).join('|')}|${priorTargetId}`);
    await raw
      .table('receiptTombstones')
      .delete(`${Object.values(scope).join('|')}|${priorTargetId}`);
    const before = await snapshotV5(raw);
    raw.close();
    await expect(resolveVerified(target, input)).rejects.toMatchObject({ code: 'corrupt_record' });
    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after)).toEqual(before);
    after.close();
    target.close();
  });

  it('does not let an unrelated evaluation counter relationship block conflict resolution', async () => {
    const baseName = databaseBase('conflict-unrelated-evaluation-counter');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const originalId = '30000000-0000-4000-8000-000000000189';
    const authoritativeId = '30000000-0000-4000-8000-000000000190';
    const unrelatedEvaluationId = '30000000-0000-4000-8000-000000000191';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: originalId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: originalId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'unrelated evaluation counter',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 7,
    });
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('queueCounters').put({
      queueKey: evaluationQueueKey(scope, unrelatedEvaluationId),
      scopeKey: Object.values(scope).join('|'),
      nextSequence: 99,
    });
    raw.close();
    await expect(
      resolveVerified(target, {
        scope,
        clientMutationId: originalId,
        action: 'use_server',
        original: {
          evaluationId: head.evaluationId,
          payloadDigest: head.payloadDigest,
          queueSequence: head.queueSequence,
        },
        local: draft,
        server: { scope, evaluationId: authoritativeId, version: 7, draft },
      }),
    ).resolves.toMatchObject({ action: 'use_server' });
    target.close();
  });

  it('uses the fresh server draft atomically and cannot resurrect discarded local work after reopen', async () => {
    const baseName = databaseBase('conflict-use-server');
    trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    const firstId = '30000000-0000-4000-8000-000000000093';
    await target.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
    });
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: firstId }));
    const head = await target.nextPendingMutation(scope);
    const authoritativeId = '30000000-0000-4000-8000-000000000098';
    await target.markNeedsAttention({
      scope,
      evaluationId: head!.evaluationId,
      clientMutationId: head!.clientMutationId,
      claimToken: head!.claimToken!,
      category: 'conflict',
      message: 'stale server version',
      conflictServerEvaluationId: authoritativeId,
      conflictServerVersion: 8,
    });
    const serverDraft = { ...draft, note: 'authoritative server draft' };
    await resolveVerified(target, {
      scope,
      clientMutationId: firstId,
      action: 'use_server',
      original: {
        evaluationId: head!.evaluationId,
        payloadDigest: head!.payloadDigest,
        queueSequence: head!.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: authoritativeId, version: 8, draft: serverDraft },
    });
    target.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    expect(await reopened.listMutations(scope)).toEqual([]);
    expect(await reopened.loadDraft(scope)).toMatchObject({
      evaluationId: authoritativeId,
      expectedVersion: 8,
      syncState: 'synced',
      draft: { note: 'authoritative server draft' },
    });
    await expect(reopened.reconcileDraftLineage(scope)).resolves.toMatchObject({
      state: 'synced',
      confirmation: { clientMutationId: firstId, evaluationId: authoritativeId, serverVersion: 8 },
      resolution: {
        action: 'use_server',
        inputLocalDraftDigest: await digestValue(
          evaluationPayload(scope, head!.evaluationId, head!.expectedVersion, draft),
        ),
      },
    });
    await expect(
      reopened.enqueueEvaluationMutation(mutation({ clientMutationId: firstId })),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    reopened.close();
  });

  it('preserves legacy keep-local artifacts for export but never replays or extends them', async () => {
    const baseName = databaseBase('legacy-keep-local-fail-closed');
    const physicalName = trackUserDatabase(baseName);
    const target = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const clientMutationId = '30000000-0000-4000-8000-000000000213';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId }));
    const head = (await target.nextPendingMutation(scope))!;
    await target.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'legacy recovery fixture',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 3,
    });
    await resolveVerified(target, {
      scope,
      clientMutationId,
      action: 'use_server',
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: head.evaluationId, version: 3, draft },
    });
    target.close();

    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const storageKey = `${Object.values(scope).join('|')}|${clientMutationId}`;
    const terminal = await raw.table('receiptTombstones').get(storageKey);
    const { tombstoneDigest: _discardedDigest, ...legacyPayload } = {
      ...terminal,
      reason: 'conflict_keep_local',
    };
    await raw.table('receiptTombstones').put({
      ...legacyPayload,
      tombstoneDigest: await digestValue(receiptTombstonePayload(legacyPayload as never)),
    });
    const protectedDraft = { ...draft, note: 'legacy local work remains exportable' };
    await raw.table('drafts').update(Object.values(scope).join('|'), {
      draft: protectedDraft,
      payloadDigest: await digestValue(
        evaluationPayload(scope, head.evaluationId, 3, protectedDraft),
      ),
      syncState: 'needs_attention',
    });
    raw.close();

    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const lineage = await reopened.reconcileDraftLineage(scope);
    expect(lineage).toMatchObject({
      state: 'needs_attention',
      draft: { draft: { note: 'legacy local work remains exportable' } },
    });
    expect(lineage.resolution).toBeUndefined();
    await expect(
      reopened.enqueueEvaluationMutation(
        mutation({ clientMutationId: '30000000-0000-4000-8000-000000000214' }),
      ),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    reopened.close();
  });

  it('rejects cross-scope conflict resolution and makes exact repeated resolution idempotent', async () => {
    const target = await prepare(repository('conflict-scope'));
    const id = '30000000-0000-4000-8000-000000000094';
    await target.enqueueEvaluationMutation(mutation({ clientMutationId: id }));
    const head = await target.nextPendingMutation(scope);
    const targetEvaluationId = mutation().evaluationId;
    await target.markNeedsAttention({
      scope,
      evaluationId: targetEvaluationId,
      clientMutationId: id,
      claimToken: head!.claimToken!,
      category: 'conflict',
      message: 'conflict',
      conflictServerEvaluationId: targetEvaluationId,
      conflictServerVersion: 3,
    });
    await expect(
      resolveVerified(target, {
        scope: { ...scope, registrationId: crypto.randomUUID() },
        clientMutationId: id,
        action: 'use_server',
        original: {
          evaluationId: head!.evaluationId,
          payloadDigest: head!.payloadDigest,
          queueSequence: head!.queueSequence,
        },
        local: draft,
        server: { scope, evaluationId: targetEvaluationId, version: 3, draft },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const input = {
      scope,
      clientMutationId: id,
      action: 'use_server' as const,
      original: {
        evaluationId: head!.evaluationId,
        payloadDigest: head!.payloadDigest,
        queueSequence: head!.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: targetEvaluationId, version: 3, draft },
    };
    const first = await resolveVerified(target, input);
    const replay = await resolveVerified(target, input);
    expect(replay).toEqual(first);
    await expect(
      resolveVerified(target, {
        ...input,
        server: { ...input.server, version: 4, draft: { ...draft, note: 'changed snapshot' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(resolveVerified(target, { ...input, action: 'keep_local' })).rejects.toMatchObject(
      {
        code: 'invalid_transition',
      },
    );
    target.close();
  });

  it('serializes concurrent use-server confirmations into one idempotent result', async () => {
    const baseName = databaseBase('conflict-tabs');
    trackUserDatabase(baseName);
    const first = await prepare(
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      }),
    );
    const second = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const id = '30000000-0000-4000-8000-000000000095';
    await first.enqueueEvaluationMutation(mutation({ clientMutationId: id }));
    const head = (await first.nextPendingMutation(scope))!;
    await first.markNeedsAttention({
      scope,
      evaluationId: head.evaluationId,
      clientMutationId: id,
      claimToken: head.claimToken!,
      category: 'conflict',
      message: 'concurrent server create',
      conflictServerEvaluationId: head.evaluationId,
      conflictServerVersion: 3,
    });
    const common = {
      scope,
      clientMutationId: id,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      local: draft,
      server: { scope, evaluationId: head.evaluationId, version: 3, draft },
    };
    const outcomes = await Promise.allSettled([
      resolveVerified(first, { ...common, action: 'use_server' }),
      resolveVerified(second, { ...common, action: 'use_server' }),
    ]);
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    if (outcomes[0].status === 'fulfilled' && outcomes[1].status === 'fulfilled')
      expect(outcomes[1].value).toEqual(outcomes[0].value);
    await expect(
      resolveVerified(second, { ...common, action: 'use_server' }),
    ).resolves.toMatchObject({ action: 'use_server' });
    first.close();
    second.close();
  });

  it.each(['nul\u0000value', '\ud800', '\udc00'])(
    'rejects PostgreSQL-incompatible note %j before IndexedDB',
    async (note) => {
      const target = await prepare(repository('unicode-reject'));
      await expect(
        target.saveDraftLocally({
          scope,
          evaluationId: mutation().evaluationId,
          expectedVersion: 0,
          draft: { ...draft, note },
        }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
      expect(await target.loadDraft(scope)).toBeNull();
      expect(await target.listMutations(scope)).toEqual([]);
      target.close();
    },
  );

  it.each(['valid 😀 emoji', 'é', 'e\u0301'])(
    'accepts valid canonical Unicode note %j',
    async (note) => {
      const target = await prepare(repository('unicode-accept'));
      await expect(
        target.saveDraftLocally({
          scope,
          evaluationId: mutation().evaluationId,
          expectedVersion: 0,
          draft: { ...draft, note },
        }),
      ).resolves.toMatchObject({ draft: { note } });
      target.close();
    },
  );

  it('matches PostgreSQL for a nested emoji and NFC/NFD canonical digest', async () => {
    await expect(digestValue({ b: [{ x: 'é' }, 2], a: { z: '😀', a: 'e\u0301' } })).resolves.toBe(
      '5ab4d537db8177b589093223d55322a499b02e56a0d797cea7f2485bcba47163',
    );
  });

  it('blocks successors behind retry backoff until the queue head is due', async () => {
    const target = await prepare(repository('fifo-backoff'));
    await target.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000043' }),
      { now: new Date('2026-08-29T10:00:00.000Z') },
    );
    await target.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000044', expectedVersion: 3 }),
      { now: new Date('2026-08-29T10:00:01.000Z') },
    );
    const head = await target.nextPendingMutation(scope, {
      now: new Date('2026-08-29T10:00:02.000Z'),
    });
    await target.recordMutationFailure({
      scope,
      evaluationId: head!.evaluationId,
      clientMutationId: head!.clientMutationId,
      claimToken: head!.claimToken!,
      category: 'network',
      message: 'temporary network error',
      now: new Date('2026-08-29T10:00:03.000Z'),
    });
    expect(
      await target.nextPendingMutation(scope, { now: new Date('2026-08-29T10:00:04.999Z') }),
    ).toBeNull();
    expect(
      (await target.nextPendingMutation(scope, { now: new Date('2026-08-29T10:00:05.000Z') }))
        ?.clientMutationId,
    ).toBe('30000000-0000-4000-8000-000000000043');
    target.close();
  });

  it('validates duplicate replay and every read instead of hiding corrupt records', async () => {
    const baseName = databaseBase('read-validation');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    await target.enqueueEvaluationMutation(mutation());
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(3).stores(v3Stores);
    await raw.open();
    await raw
      .table('mutations')
      .update(`${Object.values(scope).join('|')}|${mutation().clientMutationId}`, {
        draft: { ...draft, note: 'tampered after hashing' },
      });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.enqueueEvaluationMutation(mutation())).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    expect(await reopened.listQuarantines(scope)).toEqual([
      expect.objectContaining({ sourceTable: 'mutations', reason: 'digest_mismatch' }),
    ]);
    reopened.close();
  });

  it('upgrades real v1 bare UUID keys, rewrites physical keys, and preserves work needing context', async () => {
    const baseName = databaseBase('v1-migration');
    const physicalName = trackUserDatabase(baseName);
    const legacy = new Dexie(physicalName);
    legacy.version(1).stores({
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations: '&storageKey,&clientMutationId,status,createdAt,nextAttemptAt',
    });
    await legacy.open();
    await legacy.table('drafts').add({
      scopeKey: scope.registrationId,
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
      updatedAt: '2026-08-29T09:00:00.000Z',
      expiresAt: '2026-09-29T09:00:00.000Z',
    });
    await legacy.table('mutations').add({
      storageKey: mutation().clientMutationId,
      clientMutationId: mutation().clientMutationId,
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
      status: 'pending',
      createdAt: '2026-08-29T09:00:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
    });
    legacy.close();
    const migrated = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    expect(await migrated.listMutations(scope)).toEqual([
      expect.objectContaining({
        storageKey: `${Object.values(scope).join('|')}|${mutation().clientMutationId}`,
        status: 'needs_attention',
        errorCategory: 'migration_context_required',
      }),
    ]);
    await expect(migrated.loadDraft(scope)).rejects.toMatchObject({ code: 'corrupt_record' });
    migrated.close();
  });

  it('quarantines unknown statuses, invalid dates, cross-user rows, and physical-key collisions in v2', async () => {
    const baseName = databaseBase('v2-quarantine');
    const physicalName = trackUserDatabase(baseName);
    const legacy = new Dexie(physicalName);
    legacy.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await legacy.open();
    await legacy.table('drafts').bulkAdd([
      {
        scopeKey: 'legacy-a',
        scope,
        evaluationId: mutation().evaluationId,
        expectedVersion: 2,
        draft,
        updatedAt: '2026-08-29T09:00:00.000Z',
        expiresAt: '2026-09-29T09:00:00.000Z',
      },
      {
        scopeKey: 'legacy-b',
        scope,
        evaluationId: mutation().evaluationId,
        expectedVersion: 3,
        draft,
        updatedAt: '2026-08-29T09:01:00.000Z',
        expiresAt: '2026-09-29T09:00:00.000Z',
      },
    ]);
    await legacy.table('mutations').bulkAdd([
      {
        ...mutation(),
        storageKey: `bad-status|${mutation().clientMutationId}`,
        scopeKey: 'bad-status',
        status: 'mystery',
        createdAt: 'not-a-date',
        nextAttemptAt: 'not-a-date',
      },
      {
        ...mutation({
          scope: otherScope,
          clientMutationId: '30000000-0000-4000-8000-000000000051',
        }),
        storageKey: 'other-user',
        scopeKey: 'other-user',
        status: 'pending',
        createdAt: '2026-08-29T09:00:00.000Z',
        nextAttemptAt: '2026-08-29T09:00:00.000Z',
      },
    ]);
    legacy.close();
    const migrated = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const quarantines = await migrated.listQuarantines(scope);
    expect(quarantines.length).toBeGreaterThanOrEqual(3);
    expect(quarantines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'physical_key_collision' }),
        expect.objectContaining({ reason: 'invalid_record' }),
      ]),
    );
    migrated.close();
    const rawQuarantine = new Dexie(physicalName);
    rawQuarantine.version(3).stores(v3Stores);
    await rawQuarantine.open();
    expect(await rawQuarantine.table('quarantines').count()).toBeGreaterThanOrEqual(4);
    expect(
      await rawQuarantine
        .table('quarantines')
        .filter((item) => item.reason === 'user_mismatch')
        .count(),
    ).toBe(1);
    rawQuarantine.close();
  });

  it('imports only the authenticated user from an old shared database and leaves the source intact', async () => {
    const legacyName = databaseBase('shared-legacy');
    databaseNames.push(legacyName);
    const shared = new Dexie(legacyName);
    shared.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await shared.open();
    await shared.table('sessionContexts').add({
      scopeKey: Object.values(scope).join('|'),
      scope,
      userId: scope.userId,
      tryoutNumber: 42,
      categories: context().categories,
      expiresAt: '2026-09-29T09:00:00.000Z',
    });
    const legacyMutation = (targetScope: EvaluationStorageScope, clientMutationId: string) => ({
      ...mutation({ scope: targetScope, clientMutationId }),
      storageKey: `${Object.values(targetScope).join('|')}|${clientMutationId}`,
      scopeKey: Object.values(targetScope).join('|'),
      status: 'pending',
      syncState: 'saved_device',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:00:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
    });
    await shared
      .table('mutations')
      .bulkAdd([
        legacyMutation(scope, mutation().clientMutationId),
        legacyMutation(otherScope, '30000000-0000-4000-8000-000000000061'),
      ]);
    shared.close();
    const first = repository('shared-import-user-one');
    await expect(
      first.migrateLegacySharedDatabase({ legacyDatabaseName: legacyName }),
    ).resolves.toEqual({ imported: 2, quarantined: 0 });
    expect(await first.listMutations(scope)).toHaveLength(1);
    await first.resolveNeedsAttention({
      scope,
      evaluationId: mutation().evaluationId,
      clientMutationId: mutation().clientMutationId,
      action: 'retry',
    });
    expect(await first.nextPendingMutation(scope)).toMatchObject({
      clientMutationId: mutation().clientMutationId,
    });
    await expect(first.listMutations(otherScope)).rejects.toMatchObject({ code: 'user_mismatch' });
    first.close();
    const source = new Dexie(legacyName);
    await source.open();
    expect(await source.table('mutations').count()).toBe(2);
    source.close();
  });

  it('makes teardown decision and deletion atomic with concurrent enqueue', async () => {
    const baseName = databaseBase('teardown-race');
    trackUserDatabase(baseName);
    const first = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const second = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(first);
    const [teardown, enqueue] = await Promise.allSettled([
      first.teardownScope(scope),
      second.enqueueEvaluationMutation(mutation()),
    ]);
    const retained = await first.listMutations(scope);
    if (enqueue.status === 'fulfilled') {
      expect(teardown).toMatchObject({
        status: 'fulfilled',
        value: { cleared: false, retainedUnacknowledged: 1 },
      });
      expect(retained).toHaveLength(1);
    } else {
      expect(teardown).toMatchObject({
        status: 'fulfilled',
        value: { cleared: true, retainedUnacknowledged: 0 },
      });
      expect(enqueue.reason).toMatchObject({ code: 'context_not_found' });
      expect(retained).toHaveLength(0);
    }
    first.close();
    second.close();
  });

  it('compacts acknowledgements but retains receipt and synced state until TTL cleanup', async () => {
    const target = await prepare(repository('receipt-compaction'));
    await target.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
    });
    await target.enqueueEvaluationMutation(mutation(), {
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    const claim = await target.nextPendingMutation(scope, {
      now: new Date('2026-06-01T00:00:01.000Z'),
    });
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      claimToken: claim!.claimToken!,
      serverVersion: 3,
      acknowledgedAt: '2026-06-01T00:00:02.000Z',
      now: new Date('2026-06-01T00:00:02.000Z'),
    });
    expect(await target.clearAcknowledged(scope)).toBe(1);
    expect(await target.listMutations(scope)).toEqual([]);
    expect(await target.getReceipt(scope, mutation().clientMutationId)).toMatchObject({
      payloadDigest: claim!.payloadDigest,
      expectedVersion: 2,
      serverVersion: 3,
    });
    expect(await target.getSyncState(scope)).toBe('synced');
    await target.cleanupExpired(scope, new Date('2026-08-29T00:00:00.000Z'));
    expect(await target.getReceipt(scope, mutation().clientMutationId)).toBeNull();
    target.close();
  });

  it('never deletes leased work during teardown', async () => {
    const target = await prepare(repository('teardown-retention'));
    await target.enqueueEvaluationMutation(mutation());
    await target.nextPendingMutation(scope);
    await expect(target.teardownScope(scope)).resolves.toEqual({
      cleared: false,
      retainedUnacknowledged: 1,
    });
    expect(await target.listMutations(scope)).toHaveLength(1);
    target.close();
  });

  it('quarantines a corrupt acknowledged record instead of deleting it during teardown', async () => {
    const baseName = databaseBase('corrupt-teardown');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    await target.enqueueEvaluationMutation(mutation());
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(3).stores(v3Stores);
    await raw.open();
    await raw
      .table('mutations')
      .update(`${Object.values(scope).join('|')}|${mutation().clientMutationId}`, {
        status: 'acknowledged',
        syncState: 'synced',
        acknowledgedAt: '2026-08-29T10:00:00.000Z',
        payloadDigest: '0'.repeat(64),
      });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.teardownScope(scope)).resolves.toEqual({
      cleared: false,
      retainedUnacknowledged: 1,
    });
    expect(await reopened.listQuarantines(scope)).toEqual([
      expect.objectContaining({ sourceTable: 'mutations', reason: 'digest_mismatch' }),
    ]);
    reopened.close();
  });

  it('rejects compacted receipt tampering byte-exactly during acknowledgment replay', async () => {
    const baseName = databaseBase('receipt-integrity');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    await target.enqueueEvaluationMutation(mutation());
    const claim = await target.nextPendingMutation(scope);
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:00.000Z',
    });
    await target.clearAcknowledged(scope);
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw
      .table('receipts')
      .update(`${Object.values(scope).join('|')}|${mutation().clientMutationId}`, {
        serverVersion: 99,
      });
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(
      reopened.acknowledgeMutation({
        scope,
        evaluationId: claim!.evaluationId,
        clientMutationId: claim!.clientMutationId,
        claimToken: claim!.claimToken!,
        expectedVersion: claim!.expectedVersion,
        payloadDigest: claim!.payloadDigest,
        serverVersion: 3,
        acknowledgedAt: '2026-08-29T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'corrupt_record' });
    reopened.close();
    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    after.close();
  });

  it('maps read, cleanup, and teardown IndexedDB failures truthfully', async () => {
    const readTarget = await prepare(repository('read-failure'));
    readTarget.close();
    await expect(readTarget.loadDraft(scope)).rejects.toMatchObject({
      code: 'storage_read_failed',
    });
    const cleanupTarget = await prepare(repository('cleanup-failure'));
    cleanupTarget.close();
    await expect(cleanupTarget.cleanupExpired(scope)).rejects.toMatchObject({
      code: 'storage_cleanup_failed',
    });
    const teardownTarget = await prepare(repository('teardown-failure'));
    teardownTarget.close();
    await expect(teardownTarget.teardownScope(scope)).rejects.toMatchObject({
      code: 'storage_cleanup_failed',
    });
  });

  it('fails honestly when IndexedDB is unavailable', () => {
    expect(() =>
      createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: databaseBase('unavailable'),
        indexedDB: null,
      }),
    ).toThrowError(EvaluationOfflineError);
  });

  it('exports bounded diagnostics without draft or contact data', async () => {
    const target = await prepare(repository('privacy'));
    await target.enqueueEvaluationMutation(mutation());
    const exported = JSON.stringify(await target.exportSafeDiagnostic(scope));
    expect(exported).not.toContain('Private evaluator note');
    expect(exported).not.toContain('guardian');
    expect(exported).not.toContain('email');
    expect(exported.length).toBeLessThan(4_000);
    target.close();
  });

  it('rejects a resurrected nonterminal row beside compacted terminal authority byte-exactly', async () => {
    const baseName = databaseBase('terminal-authority');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    const queued = await target.enqueueEvaluationMutation(mutation());
    const claim = await target.nextPendingMutation(scope);
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:00.000Z',
    });
    await target.clearAcknowledged(scope);

    await expect(target.enqueueEvaluationMutation(mutation())).resolves.toMatchObject({
      clientMutationId: mutation().clientMutationId,
      status: 'acknowledged',
      syncState: 'synced',
      serverVersion: 3,
    });
    expect(await target.listMutations(scope)).toEqual([]);
    await expect(
      target.enqueueEvaluationMutation(
        mutation({ draft: { ...draft, note: 'divergent private replay' } }),
      ),
    ).rejects.toMatchObject({ code: 'receipt_mismatch' });

    target.close();
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('mutations').add({ ...queued, status: 'pending', syncState: 'saved_device' });
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    reopened.close();
    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    after.close();
  });

  it('allocates FIFO sequence atomically across tabs without timestamp or UUID ties', async () => {
    const baseName = databaseBase('atomic-sequence');
    trackUserDatabase(baseName);
    const first = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const second = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(first);
    const sameMillisecond = new Date('2026-08-29T10:00:00.000Z');
    const firstInput = mutation({
      clientMutationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      expectedVersion: 2,
    });
    const secondInput = mutation({
      clientMutationId: '00000000-0000-4000-8000-000000000001',
      expectedVersion: 3,
    });
    const firstPromise = first.enqueueEvaluationMutation(firstInput, { now: sameMillisecond });
    const secondPromise = second.enqueueEvaluationMutation(secondInput, { now: sameMillisecond });
    const [firstCommitted, secondCommitted] = await Promise.all([firstPromise, secondPromise]);
    expect([firstCommitted.queueSequence, secondCommitted.queueSequence]).toEqual([1, 2]);
    expect((await first.nextPendingMutation(scope))?.expectedVersion).toBe(2);
    const ordered = await first.listMutations(scope);
    expect(ordered.map((item) => item.expectedVersion)).toEqual([2, 3]);
    first.close();
    second.close();
  });

  it('computes sync state from one validated scope snapshot with explicit precedence', async () => {
    const target = await prepare(repository('state-precedence'));
    await target.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
    });
    await target.enqueueEvaluationMutation(mutation());
    expect(await target.getSyncState(scope)).toBe('saved_device');
    const claim = await target.nextPendingMutation(scope);
    expect(await target.getSyncState(scope)).toBe('syncing');
    await target.markNeedsAttention({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      category: 'conflict',
      message: 'requires review',
    });
    expect(await target.getSyncState(scope)).toBe('needs_attention');
    target.close();
  });

  it('never lets a synced draft hide corruption discovered later in the same state read', async () => {
    const baseName = databaseBase('state-corruption');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    await target.saveDraftLocally({
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft,
    });
    await target.enqueueEvaluationMutation(mutation());
    const claim = await target.nextPendingMutation(scope);
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:00.000Z',
    });
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(4).stores(v4Stores);
    await raw.open();
    await raw
      .table('receipts')
      .update(`${Object.values(scope).join('|')}|${mutation().clientMutationId}`, {
        receiptDigest: '0'.repeat(64),
      });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.getSyncState(scope)).rejects.toMatchObject({ code: 'corrupt_record' });
    expect(await reopened.listQuarantines(scope)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceTable: 'receipts' }),
        expect.objectContaining({ sourceTable: 'mutations' }),
      ]),
    );
    reopened.close();
  });

  it('jointly upgrades the shipped v2 acknowledged mutation and minimal receipt shapes', async () => {
    const baseName = databaseBase('v2-terminal-pair');
    const physicalName = trackUserDatabase(baseName);
    const legacy = new Dexie(physicalName);
    legacy.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await legacy.open();
    const key = Object.values(scope).join('|');
    await legacy.table('sessionContexts').add({
      scopeKey: key,
      scope,
      userId: scope.userId,
      tryoutNumber: 42,
      categories: context().categories,
      expiresAt: '2026-09-29T09:00:00.000Z',
    });
    await legacy.table('mutations').add({
      ...mutation(),
      storageKey: `${key}|${mutation().clientMutationId}`,
      scopeKey: key,
      status: 'acknowledged',
      syncState: 'synced',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:01:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
    });
    await legacy.table('receipts').add({
      storageKey: `${key}|${mutation().clientMutationId}`,
      clientMutationId: mutation().clientMutationId,
      scopeKey: key,
      scope,
      evaluationId: mutation().evaluationId,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
      expiresAt: '2026-09-29T09:01:00.000Z',
    });
    legacy.close();

    const migrated = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    expect(await migrated.listMutations(scope)).toEqual([
      expect.objectContaining({ status: 'acknowledged', queueSequence: 1 }),
    ]);
    expect(await migrated.getReceipt(scope, mutation().clientMutationId)).toMatchObject({
      expectedVersion: 2,
      serverVersion: 3,
      payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      claimToken: expect.stringMatching(/^[0-9a-f-]{36}$/),
      receiptDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    migrated.close();
  });

  it('rejects digest-changing shared imports while leaving the source untouched', async () => {
    const legacyName = databaseBase('shared-digest-mismatch');
    databaseNames.push(legacyName);
    const shared = new Dexie(legacyName);
    shared.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await shared.open();
    const key = Object.values(scope).join('|');
    await shared.table('mutations').add({
      ...mutation(),
      storageKey: `${key}|${mutation().clientMutationId}`,
      scopeKey: key,
      status: 'pending',
      syncState: 'saved_device',
      payloadDigest: '0'.repeat(64),
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:00:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
    });
    shared.close();
    const target = repository('shared-digest-target');
    await expect(
      target.migrateLegacySharedDatabase({ legacyDatabaseName: legacyName }),
    ).resolves.toEqual({ imported: 0, quarantined: 1 });
    expect(await target.listMutations(scope)).toEqual([]);
    target.close();
    const source = new Dexie(legacyName);
    await source.open();
    expect(await source.table('mutations').count()).toBe(1);
    source.close();
  });

  it('validates failure category and UTF-8 bytes before mutating a leased record', async () => {
    const target = await prepare(repository('failure-validation'));
    await target.enqueueEvaluationMutation(mutation());
    const claim = await target.nextPendingMutation(scope);
    const base = {
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      now: new Date(),
    };
    await expect(
      target.recordMutationFailure({ ...base, category: 'not-real' as never, message: 'bad' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      target.recordMutationFailure({ ...base, category: 'network', message: '🚀'.repeat(200) }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      target.recordMutationFailure({
        ...base,
        category: 'network',
        message: { toString: () => 'coerced' } as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await target.listMutations(scope)).toEqual([
      expect.objectContaining({ status: 'leased', attemptCount: 0 }),
    ]);
    target.close();
  });

  it('stores only a bounded redacted recovery envelope for injected corrupt records', async () => {
    const baseName = databaseBase('bounded-quarantine');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    const queued = await target.enqueueEvaluationMutation(mutation());
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(4).stores(v4Stores);
    await raw.open();
    await raw.table('mutations').put({
      ...queued,
      guardian: { email: 'guardian-secret@example.com', phone: '+15555555555' },
      contact: 'private-contact',
      hugeBlob: 'x'.repeat(2_000_000),
      payloadDigest: '0'.repeat(64),
    });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    reopened.close();
    const inspect = new Dexie(physicalName);
    inspect.version(4).stores(v4Stores);
    await inspect.open();
    const quarantines = await inspect.table('quarantines').toArray();
    const serialized = JSON.stringify(quarantines);
    expect(quarantines).toHaveLength(1);
    expect(serialized).not.toContain('originalRecord');
    expect(serialized).not.toContain('guardian-secret');
    expect(serialized).not.toContain('private-contact');
    expect(serialized).not.toContain('hugeBlob');
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThan(4_096);
    inspect.close();
  });

  it('rejects a structurally valid queued mutation diverging from its receipt byte-exactly', async () => {
    const baseName = databaseBase('claim-receipt-divergence');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    const queued = await target.enqueueEvaluationMutation(mutation());
    const claim = await target.nextPendingMutation(scope);
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:00.000Z',
    });
    await target.clearAcknowledged(scope);
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('mutations').add({
      ...queued,
      expectedVersion: 3,
      payloadDigest: await digestValue(evaluationPayload(scope, queued.evaluationId, 3, draft)),
    });
    const before = await snapshotV5(raw, { includeProof: true });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    reopened.close();
    const after = new Dexie(physicalName);
    after.version(5).stores(v5Stores);
    await after.open();
    expect(await snapshotV5(after, { includeProof: true })).toEqual(before);
    after.close();
  });

  it('assigns deterministic legacy sequences and advances the v4 queue counter', async () => {
    const baseName = databaseBase('v3-sequence-migration');
    const physicalName = trackUserDatabase(baseName);
    const legacy = new Dexie(physicalName);
    legacy.version(3).stores(v3Stores);
    await legacy.open();
    const key = Object.values(scope).join('|');
    const queueKey = evaluationQueueKey(scope, mutation().evaluationId);
    await legacy.table('sessionContexts').add({
      scopeKey: key,
      scope,
      tryoutNumber: 42,
      categories: context().categories,
      expiresAt: '2026-09-29T09:00:00.000Z',
    });
    const legacyMutation = async (clientMutationId: string, expectedVersion: number) => ({
      ...mutation({ clientMutationId, expectedVersion }),
      storageKey: `${key}|${clientMutationId}`,
      scopeKey: key,
      queueKey,
      payloadDigest: await digestValue(
        evaluationPayload(scope, mutation().evaluationId, expectedVersion, draft),
      ),
      status: 'pending',
      syncState: 'saved_device',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:00:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
    });
    await legacy
      .table('mutations')
      .bulkAdd([
        await legacyMutation('ffffffff-ffff-4fff-8fff-ffffffffffff', 3),
        await legacyMutation('00000000-0000-4000-8000-000000000001', 2),
      ]);
    legacy.close();
    const migrated = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    expect(
      (await migrated.listMutations(scope)).map((item) => [
        item.clientMutationId,
        item.queueSequence,
      ]),
    ).toEqual([
      ['00000000-0000-4000-8000-000000000001', 1],
      ['ffffffff-ffff-4fff-8fff-ffffffffffff', 2],
    ]);
    await expect(
      migrated.enqueueEvaluationMutation(
        mutation({
          clientMutationId: '30000000-0000-4000-8000-000000000099',
          expectedVersion: 4,
        }),
      ),
    ).resolves.toMatchObject({ queueSequence: 3 });
    migrated.close();
  });

  it('quarantines both sides of an inconsistent shipped-v2 terminal pair', async () => {
    const baseName = databaseBase('v2-inconsistent-terminal');
    const physicalName = trackUserDatabase(baseName);
    const legacy = new Dexie(physicalName);
    legacy.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await legacy.open();
    const key = Object.values(scope).join('|');
    await legacy.table('sessionContexts').add({
      scopeKey: key,
      scope,
      userId: scope.userId,
      tryoutNumber: 42,
      categories: context().categories,
      expiresAt: '2026-09-29T09:00:00.000Z',
    });
    await legacy.table('mutations').add({
      ...mutation(),
      storageKey: `${key}|${mutation().clientMutationId}`,
      scopeKey: key,
      status: 'acknowledged',
      syncState: 'synced',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:01:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
    });
    await legacy.table('receipts').add({
      storageKey: `${key}|${mutation().clientMutationId}`,
      clientMutationId: mutation().clientMutationId,
      scopeKey: key,
      scope,
      evaluationId: mutation().evaluationId,
      serverVersion: 99,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
      expiresAt: '2026-09-29T09:01:00.000Z',
    });
    legacy.close();
    const migrated = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    expect(await migrated.listMutations(scope)).toEqual([]);
    expect(await migrated.getReceipt(scope, mutation().clientMutationId)).toBeNull();
    expect(await migrated.listQuarantines(scope)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceTable: 'mutations', reason: 'terminal_pair_inconsistent' }),
        expect.objectContaining({ sourceTable: 'receipts', reason: 'terminal_pair_inconsistent' }),
      ]),
    );
    migrated.close();
  });

  it('quarantines a shared receipt digest mismatch and leaves the source receipt untouched', async () => {
    const legacyName = databaseBase('shared-receipt-digest');
    databaseNames.push(legacyName);
    const shared = new Dexie(legacyName);
    shared.version(3).stores(v3Stores);
    await shared.open();
    const key = Object.values(scope).join('|');
    await shared.table('receipts').add({
      storageKey: `${key}|${mutation().clientMutationId}`,
      clientMutationId: mutation().clientMutationId,
      scopeKey: key,
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      payloadDigest: 'a'.repeat(64),
      claimToken: '30000000-0000-4000-8000-000000000099',
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
      expiresAt: '2026-09-29T09:01:00.000Z',
      receiptDigest: '0'.repeat(64),
    });
    shared.close();
    const target = repository('shared-receipt-target');
    await expect(
      target.migrateLegacySharedDatabase({ legacyDatabaseName: legacyName }),
    ).resolves.toEqual({ imported: 0, quarantined: 1 });
    target.close();
    const source = new Dexie(legacyName);
    await source.open();
    expect(await source.table('receipts').count()).toBe(1);
    source.close();
  });

  it('jointly imports a real unsuffixed shipped-v2 terminal pair and leaves its source intact', async () => {
    const legacyName = databaseBase('real-shared-v2-terminal');
    databaseNames.push(legacyName);
    const shared = new Dexie(legacyName);
    shared.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await shared.open();
    const key = Object.values(scope).join('|');
    const payloadDigest = await digestValue(
      evaluationPayload(scope, mutation().evaluationId, mutation().expectedVersion, draft),
    );
    await shared.table('mutations').add({
      ...mutation(),
      storageKey: `${key}|${mutation().clientMutationId}`,
      scopeKey: key,
      payloadDigest,
      status: 'acknowledged',
      syncState: 'synced',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:01:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
    });
    await shared.table('receipts').add({
      storageKey: `${key}|${mutation().clientMutationId}`,
      clientMutationId: mutation().clientMutationId,
      scopeKey: key,
      scope,
      evaluationId: mutation().evaluationId,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
      expiresAt: '2026-09-29T09:01:00.000Z',
    });
    shared.close();

    const target = repository('real-shared-v2-target');
    await expect(
      target.migrateLegacySharedDatabase({ legacyDatabaseName: legacyName }),
    ).resolves.toEqual({ imported: 2, quarantined: 0 });
    expect(await target.listMutations(scope)).toEqual([
      expect.objectContaining({ status: 'acknowledged', syncState: 'synced' }),
    ]);
    expect(await target.getReceipt(scope, mutation().clientMutationId)).toMatchObject({
      expectedVersion: 2,
      serverVersion: 3,
      payloadDigest,
    });
    target.close();

    const source = new Dexie(legacyName);
    await source.open();
    expect(await source.table('mutations').count()).toBe(1);
    expect(await source.table('receipts').count()).toBe(1);
    source.close();
  });

  it('quarantines both shared-v2 terminal sides atomically instead of importing retryable work', async () => {
    const legacyName = databaseBase('real-shared-v2-inconsistent');
    databaseNames.push(legacyName);
    const shared = new Dexie(legacyName);
    shared.version(2).stores({
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await shared.open();
    const key = Object.values(scope).join('|');
    await shared.table('mutations').add({
      ...mutation(),
      storageKey: `${key}|${mutation().clientMutationId}`,
      scopeKey: key,
      status: 'acknowledged',
      syncState: 'synced',
      createdAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T09:01:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
    });
    await shared.table('receipts').add({
      storageKey: `${key}|${mutation().clientMutationId}`,
      clientMutationId: mutation().clientMutationId,
      scopeKey: key,
      scope,
      evaluationId: secondEvaluationId,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T09:01:00.000Z',
      expiresAt: '2026-09-29T09:01:00.000Z',
    });
    shared.close();

    const target = repository('real-shared-v2-inconsistent-target');
    await expect(
      target.migrateLegacySharedDatabase({ legacyDatabaseName: legacyName }),
    ).resolves.toEqual({ imported: 0, quarantined: 2 });
    expect(await target.listMutations(scope)).toEqual([]);
    expect(await target.getReceipt(scope, mutation().clientMutationId)).toBeNull();
    expect(await target.listQuarantines(scope)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceTable: 'mutations', reason: 'terminal_pair_inconsistent' }),
        expect.objectContaining({ sourceTable: 'receipts', reason: 'terminal_pair_inconsistent' }),
      ]),
    );
    target.close();
  });

  it('uses the deterministic physical key to fence a receipt whose embedded scope and id corrupt', async () => {
    const baseName = databaseBase('deterministic-receipt-tombstone');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    const queued = await target.enqueueEvaluationMutation(mutation());
    const claim = await target.nextPendingMutation(scope);
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:00.000Z',
    });
    await target.clearAcknowledged(scope);
    target.close();

    const key = `${Object.values(scope).join('|')}|${mutation().clientMutationId}`;
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('receiptTombstones').delete(key);
    await raw.table('receipts').update(key, {
      scopeKey: Object.values(otherScope).join('|'),
      scope: otherScope,
      clientMutationId: '30000000-0000-4000-8000-000000000099',
    });
    await raw.table('sessionContexts').delete(Object.values(scope).join('|'));
    await raw.table('mutations').add(queued);
    raw.close();

    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.getReceipt(scope, mutation().clientMutationId)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    await expect(reopened.enqueueEvaluationMutation(mutation())).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    await expect(reopened.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    reopened.close();

    const inspect = new Dexie(physicalName);
    inspect.version(5).stores(v5Stores);
    await inspect.open();
    expect(await inspect.table('receiptTombstones').get(key)).toMatchObject({
      storageKey: key,
      scopeKey: Object.values(scope).join('|'),
      clientMutationId: mutation().clientMutationId,
      reason: 'corrupt_receipt',
    });
    inspect.close();
  });

  it('rejects a digest-valid terminal receipt whose server version skips the exact successor', async () => {
    const baseName = databaseBase('receipt-version-lineage');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    await target.enqueueEvaluationMutation(mutation());
    const claim = await target.nextPendingMutation(scope);
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:00.000Z',
    });
    target.close();

    const key = `${Object.values(scope).join('|')}|${mutation().clientMutationId}`;
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const receipt = await raw.table('receipts').get(key);
    const { receiptDigest: _oldDigest, ...withoutDigest } = receipt;
    const changed = { ...withoutDigest, serverVersion: 4 };
    await raw.table('receipts').put({
      ...changed,
      receiptDigest: await digestValue(changed),
    });
    await raw.table('receiptTombstones').delete(key);
    raw.close();

    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.getReceipt(scope, mutation().clientMutationId)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    reopened.close();
  });

  it.each([
    [
      'missing',
      async (raw: Dexie, queueKey: string) => raw.table('queueCounters').delete(queueKey),
    ],
    [
      'behind',
      async (raw: Dexie, queueKey: string) =>
        raw.table('queueCounters').update(queueKey, { nextSequence: 1 }),
    ],
    [
      'wrong scope',
      async (raw: Dexie, queueKey: string) =>
        raw.table('queueCounters').update(queueKey, {
          scopeKey: Object.values(otherScope).join('|'),
        }),
    ],
  ])(
    'quarantines %s queue-counter lineage before claim or sync-state trust',
    async (_, corrupt) => {
      const baseName = databaseBase(`queue-counter-${_.replaceAll(' ', '-')}`);
      const physicalName = trackUserDatabase(baseName);
      const target = createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      });
      await prepare(target);
      await target.enqueueEvaluationMutation(mutation());
      target.close();
      const queueKey = evaluationQueueKey(scope, mutation().evaluationId);
      const raw = new Dexie(physicalName);
      raw.version(5).stores(v5Stores);
      await raw.open();
      await corrupt(raw, queueKey);
      raw.close();
      const reopened = createEvaluationOfflineRepository({
        authenticatedUserId: scope.userId,
        databaseName: baseName,
      });
      await expect(reopened.nextPendingMutation(scope)).rejects.toMatchObject({
        code: 'corrupt_record',
      });
      await expect(reopened.getSyncState(scope)).rejects.toMatchObject({ code: 'corrupt_record' });
      expect(await reopened.listQuarantines(scope)).toEqual(
        expect.arrayContaining([expect.objectContaining({ sourceTable: 'queueCounters' })]),
      );
      reopened.close();
    },
  );

  it('quarantines duplicate positive queue sequences before claim', async () => {
    const baseName = databaseBase('duplicate-queue-sequence');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    await target.enqueueEvaluationMutation(mutation());
    const second = await target.enqueueEvaluationMutation(
      mutation({
        clientMutationId: '30000000-0000-4000-8000-000000000099',
        expectedVersion: 3,
      }),
    );
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('mutations').update(second.storageKey, { queueSequence: 1 });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    expect(await reopened.listQuarantines(scope)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceTable: 'mutations' })]),
    );
    reopened.close();
  });

  it('omits bizarre recovery metadata and always stores a readable bounded quarantine record', async () => {
    const baseName = databaseBase('self-validating-quarantine');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    const queued = await target.enqueueEvaluationMutation(mutation());
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('mutations').put({
      ...queued,
      expectedVersion: -999,
      queueSequence: -123,
      serverVersion: Number.MAX_VALUE,
      hugeBlob: 'x'.repeat(2_000_000),
    });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    const quarantines = await reopened.listQuarantines(scope);
    expect(quarantines).toHaveLength(1);
    expect(quarantines[0]!.recoveryEnvelope).not.toHaveProperty('expectedVersion');
    expect(quarantines[0]!.recoveryEnvelope).not.toHaveProperty('queueSequence');
    expect(new TextEncoder().encode(JSON.stringify(quarantines[0])).byteLength).toBeLessThan(4_096);
    reopened.close();
  });

  it('repairs malformed stored quarantine metadata into a minimal readable attention record', async () => {
    const baseName = databaseBase('repair-quarantine-read');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    target.close();
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    await raw.table('quarantines').add({
      quarantineKey: 'not-a-uuid',
      scopeKey: Object.values(scope).join('|'),
      sourceTable: 'anything',
      sourceKey: 'unsafe|contact@example.com',
      reason: 'anything',
      diagnostic: 'x'.repeat(20_000),
      status: 'needs_attention',
      createdAt: 'bizarre',
      recoveryEnvelope: { expectedVersion: -1, guardian: 'secret' },
    });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.listQuarantines(scope)).resolves.toEqual([
      expect.objectContaining({
        sourceTable: 'mutations',
        reason: 'invalid_record',
        status: 'needs_attention',
        recoveryEnvelope: { scopeKey: Object.values(scope).join('|') },
      }),
    ]);
    reopened.close();
  });

  it('replaces a corrupt tombstone with a permanent physical-key fence after receipt expiry', async () => {
    const baseName = databaseBase('terminal-tombstone-teardown');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    const queued = await target.enqueueEvaluationMutation(mutation(), {
      now: new Date('2026-06-01T09:59:00.000Z'),
    });
    const claim = await target.nextPendingMutation(scope, {
      now: new Date('2026-06-01T09:59:30.000Z'),
    });
    await target.acknowledgeMutation({
      scope,
      evaluationId: claim!.evaluationId,
      clientMutationId: claim!.clientMutationId,
      claimToken: claim!.claimToken!,
      expectedVersion: claim!.expectedVersion,
      payloadDigest: claim!.payloadDigest,
      serverVersion: 3,
      acknowledgedAt: '2026-06-01T09:59:40.000Z',
      now: new Date('2026-06-01T09:59:40.000Z'),
    });
    await target.clearAcknowledged(scope);
    await expect(
      target.cleanupExpired(scope, new Date('2026-08-29T10:00:00.000Z')),
    ).resolves.toMatchObject({ receipts: 1 });
    target.close();

    const trustedScopeKey = Object.values(scope).join('|');
    const physicalKey = `${trustedScopeKey}|${mutation().clientMutationId}`;
    const tamperedClientMutationId = '30000000-0000-4000-8000-000000000099';
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    const tombstone = await raw.table('receiptTombstones').get(physicalKey);
    await expect(raw.table('receipts').get(physicalKey)).resolves.toBeUndefined();
    await raw.table('receiptTombstones').put({
      ...tombstone,
      scopeKey: Object.values(otherScope).join('|'),
      clientMutationId: tamperedClientMutationId,
      tombstoneDigest: '0'.repeat(64),
      guardianEmail: 'guardian@example.com',
    });
    await raw.table('sessionContexts').delete(trustedScopeKey);
    await raw.table('drafts').delete(trustedScopeKey);
    raw.close();

    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.teardownScope(scope)).resolves.toEqual({
      cleared: false,
      retainedUnacknowledged: 1,
    });
    await expect(reopened.teardownScope(scope)).resolves.toEqual({
      cleared: false,
      retainedUnacknowledged: 1,
    });
    const quarantines = await reopened.listQuarantines(scope);
    expect(quarantines).toEqual([
      expect.objectContaining({
        scopeKey: trustedScopeKey,
        sourceTable: 'receiptTombstones',
        sourceKey: physicalKey,
        reason: 'digest_mismatch',
        recoveryEnvelope: expect.objectContaining({
          scopeKey: trustedScopeKey,
          clientMutationId: mutation().clientMutationId,
        }),
      }),
    ]);
    expect(JSON.stringify(quarantines)).not.toContain('guardian@example.com');
    await expect(reopened.getSyncState(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    await expect(reopened.enqueueEvaluationMutation(mutation())).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    reopened.close();

    const inspect = new Dexie(physicalName);
    inspect.version(5).stores(v5Stores);
    await inspect.open();
    expect(await inspect.table('receiptTombstones').get(physicalKey)).toMatchObject({
      storageKey: physicalKey,
      scopeKey: trustedScopeKey,
      clientMutationId: mutation().clientMutationId,
      reason: 'corrupt_receipt',
    });
    expect(await inspect.table('receiptTombstones').count()).toBe(1);
    expect(await inspect.table('receipts').get(physicalKey)).toBeUndefined();
    await inspect.table('quarantines').clear();
    inspect.close();

    const replayed = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(replayed.teardownScope(scope)).resolves.toEqual({
      cleared: false,
      retainedUnacknowledged: 1,
    });
    await replayed.saveSessionContext(context());
    await expect(replayed.enqueueEvaluationMutation(mutation())).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    const inject = new Dexie(physicalName);
    inject.version(5).stores(v5Stores);
    await inject.open();
    await inject.table('mutations').put(queued);
    inject.close();
    await expect(replayed.nextPendingMutation(scope)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    replayed.close();
  });

  it('repairs malformed quarantines by exact legal IndexedDB primary key idempotently', async () => {
    const baseName = databaseBase('repair-runtime-quarantine-keys');
    const physicalName = trackUserDatabase(baseName);
    const target = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await prepare(target);
    target.close();

    const trustedScopeKey = Object.values(scope).join('|');
    const runtimeKeys: IDBValidKey[] = [
      42,
      new Date('2026-08-29T12:00:00.000Z'),
      ['legal', 7, new Date('2026-08-29T12:01:00.000Z')],
    ];
    const raw = new Dexie(physicalName);
    raw.version(5).stores(v5Stores);
    await raw.open();
    for (const quarantineKey of runtimeKeys) {
      await raw.table('quarantines').add({
        quarantineKey,
        scopeKey: trustedScopeKey,
        sourceTable: 'anything',
        sourceKey: 'guardian@example.com',
        reason: 'anything',
        diagnostic: 'sensitive raw guardian@example.com',
        status: 'needs_attention',
        createdAt: 'bizarre',
        recoveryEnvelope: { guardianEmail: 'guardian@example.com' },
      });
    }
    raw.close();

    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    const first = await reopened.listQuarantines(scope);
    const second = await reopened.listQuarantines(scope);
    expect(first).toEqual(second);
    expect(first).toHaveLength(runtimeKeys.length);
    expect(first.every((record) => record.scopeKey === trustedScopeKey)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('guardian@example.com');
    reopened.close();

    const inspect = new Dexie(physicalName);
    inspect.version(5).stores(v5Stores);
    await inspect.open();
    const repairedKeys = await inspect.table('quarantines').toCollection().primaryKeys();
    const repairedRows = await inspect.table('quarantines').toArray();
    expect(repairedKeys).toHaveLength(runtimeKeys.length);
    expect(repairedKeys.every((key) => typeof key === 'string')).toBe(true);
    expect(
      repairedRows.sort(
        (left, right) =>
          String(left.createdAt).localeCompare(String(right.createdAt)) ||
          String(left.quarantineKey).localeCompare(String(right.quarantineKey)),
      ),
    ).toEqual(first);
    expect(JSON.stringify(repairedRows)).not.toContain('guardian@example.com');
    inspect.close();
  });
});
