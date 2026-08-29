import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EvaluationOfflineError,
  createEvaluationOfflineRepository,
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

const mutation = (
  overrides: Partial<EvaluationMutationInput> = {},
): EvaluationMutationInput & { clientMutationId: string } => ({
  scope,
  evaluationId: '30000000-0000-4000-8000-000000000001',
  clientMutationId: '30000000-0000-4000-8000-000000000002',
  expectedVersion: 2,
  draft: {
    scores: [{ categoryId: '40000000-0000-4000-8000-000000000001', value: 4 }],
    note: 'Private evaluator note',
    noteTagIds: ['40000000-0000-4000-8000-000000000002'],
    flags: ['needs_another_look'],
  },
  ...overrides,
});

let databaseNames: string[] = [];
let sequence = 0;

function databaseName(label: string): string {
  const name = `tryoutflow-test-${label}-${sequence++}`;
  databaseNames.push(name);
  return name;
}

beforeEach(() => {
  databaseNames = [];
});

afterEach(async () => {
  await Promise.all(databaseNames.map((name) => Dexie.delete(name)));
});

describe('evaluation offline outbox', () => {
  it('persists a scoped draft across a database close and reopen', async () => {
    const name = databaseName('reopen');
    const first = createEvaluationOfflineRepository({ databaseName: name });

    await expect(
      first.saveDraftLocally({
        scope,
        evaluationId: mutation().evaluationId,
        expectedVersion: 2,
        draft: mutation().draft,
      }),
    ).resolves.toMatchObject({ syncState: 'saved_device' });
    first.close();

    const reopened = createEvaluationOfflineRepository({ databaseName: name });
    await expect(reopened.loadDraft(scope)).resolves.toMatchObject({
      expectedVersion: 2,
      draft: { note: 'Private evaluator note' },
    });
    reopened.close();
  });

  it('reports saving locally before the durable device commit', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('states') });
    const states: string[] = [];

    await repository.saveDraftLocally(
      {
        scope,
        evaluationId: mutation().evaluationId,
        expectedVersion: 2,
        draft: mutation().draft,
      },
      { onSyncState: (state) => states.push(state) },
    );

    expect(states).toEqual(['saving_local', 'saved_device']);
    repository.close();
  });

  it('queues mutations in deterministic FIFO order and claims each with a lease', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('fifo') });
    await repository.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000011' }),
      { now: new Date('2026-08-29T10:00:00.000Z') },
    );
    await repository.enqueueEvaluationMutation(
      mutation({ clientMutationId: '30000000-0000-4000-8000-000000000012' }),
      { now: new Date('2026-08-29T10:00:00.000Z') },
    );

    const first = await repository.nextPendingMutation({
      now: new Date('2026-08-29T10:01:00.000Z'),
      leaseOwner: 'tab-a',
    });
    const second = await repository.nextPendingMutation({
      now: new Date('2026-08-29T10:01:00.000Z'),
      leaseOwner: 'tab-b',
    });

    expect(first).toMatchObject({
      clientMutationId: '30000000-0000-4000-8000-000000000011',
      expectedVersion: 2,
      syncState: 'syncing',
      leaseOwner: 'tab-a',
    });
    expect(second?.clientMutationId).toBe('30000000-0000-4000-8000-000000000012');
    repository.close();
  });

  it('treats the same client mutation and payload as idempotent but rejects changed payloads', async () => {
    const repository = createEvaluationOfflineRepository({
      databaseName: databaseName('duplicate'),
    });
    const original = await repository.enqueueEvaluationMutation(mutation());
    const replay = await repository.enqueueEvaluationMutation(mutation());

    expect(replay.clientMutationId).toBe(original.clientMutationId);
    expect(replay.payloadDigest).toBe(original.payloadDigest);
    await expect(
      repository.enqueueEvaluationMutation(
        mutation({ draft: { ...mutation().draft, note: 'Changed private note' } }),
      ),
    ).rejects.toMatchObject({ code: 'mutation_id_conflict' });
    repository.close();
  });

  it('acknowledges only the exact mutation and stores the minimal server receipt', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('ack') });
    await repository.enqueueEvaluationMutation(mutation());

    await expect(
      repository.acknowledgeMutation({
        scope,
        clientMutationId: mutation().clientMutationId,
        evaluationId: mutation().evaluationId,
        serverVersion: 3,
        acknowledgedAt: '2026-08-29T10:02:00.000Z',
      }),
    ).resolves.toMatchObject({ syncState: 'synced', serverVersion: 3 });

    expect(await repository.nextPendingMutation()).toBeNull();
    await expect(
      repository.acknowledgeMutation({
        scope,
        clientMutationId: mutation().clientMutationId,
        evaluationId: '30000000-0000-4000-8000-000000000099',
        serverVersion: 4,
        acknowledgedAt: '2026-08-29T10:03:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'receipt_mismatch' });
    await expect(
      repository.acknowledgeMutation({
        scope,
        clientMutationId: mutation().clientMutationId,
        evaluationId: mutation().evaluationId,
        serverVersion: 4,
        acknowledgedAt: '2026-08-29T10:03:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'receipt_mismatch' });
    repository.close();
  });

  it('applies retry backoff and promotes terminal failures to needs attention', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('retry') });
    await repository.enqueueEvaluationMutation(mutation(), {
      now: new Date('2026-08-29T09:58:00.000Z'),
    });
    await repository.nextPendingMutation({
      now: new Date('2026-08-29T09:59:00.000Z'),
      leaseOwner: 'retry-worker',
    });

    const retry = await repository.recordMutationFailure(mutation().clientMutationId, {
      category: 'network',
      message: 'Connection dropped',
      now: new Date('2026-08-29T10:00:00.000Z'),
      leaseOwner: 'retry-worker',
    });
    expect(retry).toMatchObject({ attemptCount: 1, syncState: 'saved_device' });
    expect(retry.nextAttemptAt).toBe('2026-08-29T10:00:02.000Z');
    expect(
      await repository.nextPendingMutation({ now: new Date('2026-08-29T10:00:01.999Z') }),
    ).toBeNull();

    const attention = await repository.markNeedsAttention(mutation().clientMutationId, {
      category: 'conflict',
      message: 'Server version changed',
      now: new Date('2026-08-29T10:01:00.000Z'),
    });
    expect(attention).toMatchObject({ syncState: 'needs_attention', errorCategory: 'conflict' });
    repository.close();
  });

  it('rejects a stale worker failure after another tab acquires the expired lease', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('lease') });
    await repository.enqueueEvaluationMutation(mutation(), {
      now: new Date('2026-08-29T10:00:00.000Z'),
    });
    await repository.nextPendingMutation({
      now: new Date('2026-08-29T10:00:01.000Z'),
      leaseOwner: 'tab-a',
      leaseDurationMs: 1_000,
    });
    await repository.nextPendingMutation({
      now: new Date('2026-08-29T10:00:02.001Z'),
      leaseOwner: 'tab-b',
    });

    await expect(
      repository.recordMutationFailure(mutation().clientMutationId, {
        category: 'network',
        message: 'Late failure from stale worker',
        now: new Date('2026-08-29T10:00:03.000Z'),
        leaseOwner: 'tab-a',
      }),
    ).rejects.toMatchObject({ code: 'lease_mismatch' });
    repository.close();
  });

  it('clears acknowledged records but never deletes pending or needs-attention work', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('clear') });
    const acknowledged = mutation({ clientMutationId: '30000000-0000-4000-8000-000000000021' });
    const pending = mutation({ clientMutationId: '30000000-0000-4000-8000-000000000022' });
    const attention = mutation({ clientMutationId: '30000000-0000-4000-8000-000000000023' });
    await repository.enqueueEvaluationMutation(acknowledged);
    await repository.enqueueEvaluationMutation(pending);
    await repository.enqueueEvaluationMutation(attention);
    await repository.acknowledgeMutation({
      scope,
      clientMutationId: acknowledged.clientMutationId,
      evaluationId: acknowledged.evaluationId,
      serverVersion: 3,
      acknowledgedAt: '2026-08-29T10:00:00.000Z',
    });
    await repository.markNeedsAttention(attention.clientMutationId, {
      category: 'forbidden',
      message: 'Assignment ended',
    });

    await expect(repository.clearAcknowledged(scope)).resolves.toBe(1);
    expect(await repository.listMutations(scope)).toEqual([
      expect.objectContaining({ clientMutationId: pending.clientMutationId }),
      expect.objectContaining({ clientMutationId: attention.clientMutationId }),
    ]);
    await expect(repository.teardownScope(scope)).resolves.toMatchObject({
      cleared: false,
      retainedUnacknowledged: 2,
    });
    repository.close();
  });

  it('isolates every record by full evaluator, tenant, session, registration, and rubric scope', async () => {
    const name = databaseName('scope');
    const repository = createEvaluationOfflineRepository({ databaseName: name });
    await repository.enqueueEvaluationMutation(mutation());
    await repository.enqueueEvaluationMutation(
      mutation({
        scope: otherScope,
        clientMutationId: '30000000-0000-4000-8000-000000000032',
      }),
    );

    expect(await repository.listMutations(scope)).toHaveLength(1);
    expect(await repository.listMutations(otherScope)).toHaveLength(1);
    expect(
      await repository.loadDraft({ ...scope, rubricVersionId: crypto.randomUUID() }),
    ).toBeNull();
    repository.close();

    const raw = new Dexie(name);
    raw.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await raw.open();
    const keys = (await raw.table('mutations').toCollection().primaryKeys()) as string[];
    expect(keys).toEqual(
      expect.arrayContaining([
        `${Object.values(scope).join('|')}|${mutation().clientMutationId}`,
        `${Object.values(otherScope).join('|')}|30000000-0000-4000-8000-000000000032`,
      ]),
    );
    raw.close();
  });

  it('stores no athlete display identity, guardian/contact data, or peer data', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('privacy') });
    await repository.enqueueEvaluationMutation(mutation());
    const exported = JSON.stringify(await repository.exportSafeDiagnostic(scope));

    expect(exported).not.toContain('displayName');
    expect(exported).not.toContain('guardian');
    expect(exported).not.toContain('email');
    expect(exported).not.toContain('phone');
    expect(exported).not.toContain('peer');
    expect(exported).not.toContain('Private evaluator note');
    repository.close();
  });

  it('migrates a version-one database without losing pending work', async () => {
    const name = databaseName('migration');
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations: '&storageKey,&clientMutationId,scopeKey,status,createdAt,nextAttemptAt',
    });
    await legacy.open();
    const scopeKey = Object.values(scope).join('|');
    await legacy.table('mutations').add({
      storageKey: `${scopeKey}|${mutation().clientMutationId}`,
      clientMutationId: mutation().clientMutationId,
      scopeKey,
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft: mutation().draft,
      status: 'pending',
      createdAt: '2026-08-29T09:00:00.000Z',
      nextAttemptAt: '2026-08-29T09:00:00.000Z',
      attemptCount: 0,
    });
    legacy.close();

    const repository = createEvaluationOfflineRepository({ databaseName: name });
    await expect(
      repository.nextPendingMutation({ now: new Date('2026-08-29T10:00:00.000Z') }),
    ).resolves.toMatchObject({ clientMutationId: mutation().clientMutationId });
    repository.close();
  });

  it('retains malformed unacknowledged records and reports corruption honestly', async () => {
    const name = databaseName('corruption');
    const repository = createEvaluationOfflineRepository({ databaseName: name });
    await repository.enqueueEvaluationMutation(mutation());
    repository.close();

    const raw = new Dexie(name);
    raw.version(2).stores({
      sessionContexts: '&scopeKey,userId,expiresAt',
      drafts: '&scopeKey,updatedAt,expiresAt',
      mutations:
        '&storageKey,&clientMutationId,scopeKey,status,[status+nextAttemptAt],[scopeKey+status],createdAt',
      receipts: '&storageKey,&clientMutationId,scopeKey,acknowledgedAt,expiresAt',
    });
    await raw.open();
    await raw
      .table('mutations')
      .update(`${Object.values(scope).join('|')}|${mutation().clientMutationId}`, {
        draft: { ...mutation().draft, note: 'Tampered but structurally valid note' },
      });
    raw.close();

    const reopened = createEvaluationOfflineRepository({ databaseName: name });
    await expect(reopened.nextPendingMutation()).rejects.toMatchObject({ code: 'corrupt_record' });
    expect(await reopened.countRawMutations()).toBe(1);
    reopened.close();
  });

  it('fails honestly when IndexedDB is unavailable', () => {
    expect(() =>
      createEvaluationOfflineRepository({
        databaseName: databaseName('unavailable'),
        indexedDB: null,
      }),
    ).toThrowError(EvaluationOfflineError);
    try {
      createEvaluationOfflineRepository({ databaseName: 'unavailable', indexedDB: null });
    } catch (error) {
      expect(error).toMatchObject({ code: 'storage_unavailable' });
    }
  });

  it('categorizes quota and transaction-open failures without claiming a device save', async () => {
    const quotaFactory = {
      open: () => {
        throw new DOMException('Device quota reached', 'QuotaExceededError');
      },
    } as unknown as IDBFactory;
    const brokenFactory = {
      open: () => {
        throw new DOMException('Transaction unavailable', 'InvalidStateError');
      },
    } as unknown as IDBFactory;
    const input = {
      scope,
      evaluationId: mutation().evaluationId,
      expectedVersion: 2,
      draft: mutation().draft,
    };

    await expect(
      createEvaluationOfflineRepository({
        databaseName: databaseName('quota'),
        indexedDB: quotaFactory,
      }).saveDraftLocally(input),
    ).rejects.toMatchObject({ code: 'storage_limit' });
    await expect(
      createEvaluationOfflineRepository({
        databaseName: databaseName('transaction-failure'),
        indexedDB: brokenFactory,
      }).saveDraftLocally(input),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
  });

  it('does not claim the same mutation from concurrent repository instances', async () => {
    const name = databaseName('concurrent');
    const first = createEvaluationOfflineRepository({ databaseName: name });
    const second = createEvaluationOfflineRepository({ databaseName: name });
    await first.enqueueEvaluationMutation(mutation());

    const claims = await Promise.all([
      first.nextPendingMutation({ leaseOwner: 'tab-a' }),
      second.nextPendingMutation({ leaseOwner: 'tab-b' }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    first.close();
    second.close();
  });

  it('cleans expired acknowledged data but retains expired drafts with unacknowledged work', async () => {
    const repository = createEvaluationOfflineRepository({ databaseName: databaseName('ttl') });
    const old = new Date('2026-06-01T00:00:00.000Z');
    await repository.saveDraftLocally(
      {
        scope,
        evaluationId: mutation().evaluationId,
        expectedVersion: 2,
        draft: mutation().draft,
      },
      { now: old },
    );
    await repository.enqueueEvaluationMutation(mutation(), { now: old });

    await repository.cleanupExpired(new Date('2026-08-29T00:00:00.000Z'));
    expect(await repository.loadDraft(scope)).not.toBeNull();
    expect(await repository.listMutations(scope)).toHaveLength(1);

    await repository.acknowledgeMutation({
      scope,
      clientMutationId: mutation().clientMutationId,
      evaluationId: mutation().evaluationId,
      serverVersion: 3,
      acknowledgedAt: '2026-06-02T00:00:00.000Z',
    });
    await expect(
      repository.cleanupExpired(new Date('2026-08-29T00:00:00.000Z')),
    ).resolves.toMatchObject({ acknowledgedMutations: 1, drafts: 1 });
    expect(await repository.loadDraft(scope)).toBeNull();
    expect(await repository.listMutations(scope)).toHaveLength(0);
    repository.close();
  });

  it('keeps the stored payload immutable when callers mutate returned objects', async () => {
    const repository = createEvaluationOfflineRepository({
      databaseName: databaseName('immutable'),
    });
    const queued = await repository.enqueueEvaluationMutation(mutation());
    queued.draft.note = 'Caller mutation';
    queued.draft.scores[0]!.value = 1;

    expect(await repository.listMutations(scope)).toEqual([
      expect.objectContaining({
        draft: expect.objectContaining({
          note: 'Private evaluator note',
          scores: [{ categoryId: '40000000-0000-4000-8000-000000000001', value: 4 }],
        }),
      }),
    ]);
    repository.close();
  });
});
