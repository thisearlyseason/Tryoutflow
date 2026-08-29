import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

async function prepare(target: ReturnType<typeof repository>, targetScope = scope) {
  await target.saveSessionContext(context(targetScope));
  return target;
}

const v3Stores = {
  sessionContexts: '&scopeKey,expiresAt',
  drafts: '&scopeKey,updatedAt,expiresAt',
  mutations:
    '&storageKey,&clientMutationId,scopeKey,queueKey,status,[scopeKey+status],createdAt,nextAttemptAt',
  receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
  quarantines: '&quarantineKey,scopeKey,sourceTable,status,createdAt',
};

beforeEach(() => {
  databaseNames = [];
  resetEvaluationOfflineUser();
});

afterEach(async () => {
  resetEvaluationOfflineUser();
  await Promise.all([...new Set(databaseNames)].map((name) => Dexie.delete(name)));
});

describe('evaluation offline outbox', () => {
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
      payloadDigest: 'legacy-recomputed-during-import',
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

  it('detects and quarantines compacted receipt tampering', async () => {
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
    raw.version(3).stores(v3Stores);
    await raw.open();
    await raw
      .table('receipts')
      .update(`${Object.values(scope).join('|')}|${mutation().clientMutationId}`, {
        serverVersion: 99,
      });
    raw.close();
    const reopened = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName: baseName,
    });
    await expect(reopened.getReceipt(scope, mutation().clientMutationId)).rejects.toMatchObject({
      code: 'corrupt_record',
    });
    expect(await reopened.listQuarantines(scope)).toEqual([
      expect.objectContaining({ sourceTable: 'receipts', reason: 'digest_mismatch' }),
    ]);
    reopened.close();
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
});
