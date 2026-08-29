import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import { createEvaluationOfflineRepository } from '../../../src/modules/evaluations/offline/repository';
import {
  createEvaluationMutationSender,
  EvaluationMutationSendError,
  EvaluationSynchronizer,
} from '../../../src/modules/evaluations/offline/synchronizer';

const scope = {
  userId: '72000000-0000-4000-8000-000000000001',
  evaluatorId: '72000000-0000-4000-8000-000000000001',
  organizationId: '72000000-0000-4000-8000-000000000002',
  tryoutId: '72000000-0000-4000-8000-000000000003',
  sessionId: '72000000-0000-4000-8000-000000000004',
  registrationId: '72000000-0000-4000-8000-000000000005',
  rubricVersionId: '72000000-0000-4000-8000-000000000006',
};
const evaluationId = '72000000-0000-4000-8000-000000000007';
const categoryId = '72000000-0000-4000-8000-000000000008';

async function queuedRepository(databaseName = `sync-test-${crypto.randomUUID()}`) {
  const repository = createEvaluationOfflineRepository({
    authenticatedUserId: scope.userId,
    databaseName,
  });
  await repository.saveSessionContext({
    scope,
    tryoutNumber: 42,
    categories: [{ id: categoryId, scaleMin: 1, scaleMax: 5, required: true }],
  });
  await repository.saveDraftLocally({
    scope,
    evaluationId,
    expectedVersion: 0,
    draft: { scores: [{ categoryId, value: 4 }], noteTagIds: [], flags: [] },
  });
  await repository.enqueueEvaluationMutation({
    scope,
    evaluationId,
    expectedVersion: 0,
    draft: { scores: [{ categoryId, value: 4 }], noteTagIds: [], flags: [] },
  });
  return repository;
}

describe('EvaluationSynchronizer', () => {
  it.each([
    [401, 'unauthorized', 'forbidden'],
    [403, 'forbidden', 'forbidden'],
    [409, 'mutation_id_conflict', 'conflict'],
    [400, 'invalid_input', 'invalid_input'],
    [413, 'invalid_request', 'invalid_input'],
    [415, 'invalid_request', 'invalid_input'],
    [429, 'rate_limited', 'rate_limited'],
    [503, 'temporarily_unavailable', 'transient'],
  ] as const)('maps HTTP %s to the typed non-oracle outcome %s', async (status, code, category) => {
    const repository = await queuedRepository();
    const entry = (await repository.nextPendingMutation(scope))!;
    const sender = createEvaluationMutationSender(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: code }), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
      ) as never,
    );
    await expect(sender(entry)).rejects.toMatchObject({
      name: 'EvaluationMutationSendError',
      category,
    });
    repository.close();
  });

  it('rejects malformed or oversized error bodies as transient without reflecting details', async () => {
    const repository = await queuedRepository();
    const entry = (await repository.nextPendingMutation(scope))!;
    for (const body of ['{"error":"secret_internal_value"}', 'x'.repeat(5_000)]) {
      const sender = createEvaluationMutationSender(
        vi.fn(
          async () =>
            new Response(body, { status: 400, headers: { 'content-type': 'application/json' } }),
        ) as never,
      );
      await expect(sender(entry)).rejects.toEqual(
        expect.objectContaining({ category: 'transient', message: 'sync_response_invalid' }),
      );
    }
    repository.close();
  });

  it('does not resend acknowledged work on a repeated flush', async () => {
    const repository = await queuedRepository();
    let requests = 0;
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      send: async (entry) => {
        requests += 1;
        return {
          outcome: 'synced',
          clientMutationId: entry.clientMutationId,
          evaluationId: entry.evaluationId,
          expectedVersion: entry.expectedVersion,
          serverVersion: entry.expectedVersion + 1,
          payloadDigest: entry.payloadDigest,
          acknowledgedAt: '2026-08-29T12:00:00.000Z',
        };
      },
    });
    await synchronizer.flush();
    await synchronizer.flush();
    expect(requests).toBe(1);
    await expect(repository.getSyncState(scope)).resolves.toBe('synced');
    repository.close();
  });

  it('backs off and safely replays the same mutation after a lost HTTP response', async () => {
    const repository = await queuedRepository();
    let now = new Date();
    let retry: (() => void) | null = null;
    let retryDelay = 0;
    let requests = 0;
    let serverWrites = 0;
    let storedReceipt: {
      outcome: 'synced';
      clientMutationId: string;
      evaluationId: string;
      expectedVersion: number;
      serverVersion: number;
      payloadDigest: string;
      acknowledgedAt: string;
    } | null = null;
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      now: () => now,
      schedule(callback, delayMs) {
        retry = callback;
        retryDelay = delayMs;
        return 'retry-timer';
      },
      cancel: vi.fn(),
      send: async (entry) => {
        requests += 1;
        if (!storedReceipt) {
          serverWrites += 1;
          storedReceipt = {
            outcome: 'synced',
            clientMutationId: entry.clientMutationId,
            evaluationId: entry.evaluationId,
            expectedVersion: entry.expectedVersion,
            serverVersion: entry.expectedVersion + 1,
            payloadDigest: entry.payloadDigest,
            acknowledgedAt: '2026-08-29T12:00:00.000Z',
          };
          throw new Error('response lost after commit');
        }
        return storedReceipt;
      },
    });
    synchronizer.start();
    await synchronizer.flush();
    expect(requests).toBe(1);
    expect(retryDelay).toBeGreaterThan(0);
    expect(retry).not.toBeNull();
    now = new Date(now.getTime() + retryDelay + 1);
    retry!();
    await synchronizer.flush();
    expect(requests).toBe(2);
    expect(serverWrites).toBe(1);
    await expect(repository.getSyncState(scope)).resolves.toBe('synced');
    synchronizer.stop();
    repository.close();
  });

  it('retains stale-version work as needs attention instead of acknowledging it', async () => {
    const repository = await queuedRepository();
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      send: async (entry) => ({
        outcome: 'conflict',
        clientMutationId: entry.clientMutationId,
        evaluationId: entry.evaluationId,
        expectedVersion: entry.expectedVersion,
        payloadDigest: entry.payloadDigest,
        serverVersion: 3,
        acknowledgedAt: '2026-08-29T12:00:00.000Z',
      }),
    });
    await synchronizer.flush();
    expect((await repository.listMutations(scope))[0]).toMatchObject({
      status: 'needs_attention',
      errorCategory: 'conflict',
    });
    repository.close();
  });

  it('moves deterministic transport failures directly to attention and publishes scoped events', async () => {
    const repository = await queuedRepository();
    const events: { state: string; evaluationId: string }[] = [];
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      send: async () => {
        throw new EvaluationMutationSendError('forbidden', 'sync_forbidden');
      },
    });
    const unsubscribe = synchronizer.subscribe((event) => {
      events.push({ state: event.state, evaluationId: event.evaluationId });
      throw new Error('subscriber isolation');
    });
    await synchronizer.flush();
    expect((await repository.listMutations(scope))[0]).toMatchObject({
      status: 'needs_attention',
      attemptCount: 1,
      errorCategory: 'forbidden',
    });
    expect(events).toEqual([{ state: 'needs_attention', evaluationId }]);
    unsubscribe();
    repository.close();
  });

  it('publishes scheduled retry success without an online event', async () => {
    const repository = await queuedRepository();
    let now = new Date();
    let timer: (() => void) | null = null;
    let attempts = 0;
    const states: string[] = [];
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      now: () => now,
      schedule(callback) {
        timer = callback;
        return 'timer';
      },
      send: async (entry) => {
        attempts += 1;
        if (attempts === 1) throw new EvaluationMutationSendError('transient', 'temporary');
        return {
          outcome: 'synced',
          clientMutationId: entry.clientMutationId,
          evaluationId: entry.evaluationId,
          expectedVersion: entry.expectedVersion,
          serverVersion: entry.expectedVersion + 1,
          payloadDigest: entry.payloadDigest,
          acknowledgedAt: now.toISOString(),
        };
      },
    });
    synchronizer.subscribe((event) => states.push(event.state));
    synchronizer.start();
    await synchronizer.flush();
    expect(states).toEqual(['saved_device']);
    now = new Date(now.getTime() + 3_000);
    timer!();
    await synchronizer.flush();
    expect(states).toEqual(['saved_device', 'synced']);
    synchronizer.stop();
    repository.close();
  });

  it('fences an in-flight generation after stop and never claims a later FIFO head', async () => {
    const repository = await queuedRepository();
    await repository.enqueueEvaluationMutation({
      scope,
      evaluationId,
      expectedVersion: 1,
      draft: { scores: [{ categoryId, value: 5 }], noteTagIds: [], flags: [] },
    });
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => (release = resolve));
    const sent: string[] = [];
    const events: string[] = [];
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      send: async (entry) => {
        sent.push(entry.clientMutationId);
        await deferred;
        return {
          outcome: 'synced',
          clientMutationId: entry.clientMutationId,
          evaluationId: entry.evaluationId,
          expectedVersion: entry.expectedVersion,
          serverVersion: entry.expectedVersion + 1,
          payloadDigest: entry.payloadDigest,
          acknowledgedAt: new Date().toISOString(),
        };
      },
    });
    synchronizer.subscribe((event) => events.push(event.state));
    synchronizer.start();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    synchronizer.stop();
    release();
    await synchronizer.flush();
    expect(sent).toHaveLength(1);
    expect(events).toEqual([]);
    expect(
      (await repository.listMutations(scope)).filter((row) => row.status === 'pending'),
    ).toHaveLength(1);
    repository.close();
  });

  it('starts a new generation after StrictMode cleanup and replays the stale lease at expiry', async () => {
    const repository = await queuedRepository();
    let now = new Date();
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => (release = resolve));
    let timer: (() => void) | null = null;
    let sends = 0;
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      now: () => now,
      schedule(callback) {
        timer = callback;
        return 'restart-timer';
      },
      send: async (entry) => {
        sends += 1;
        if (sends === 1) await deferred;
        return {
          outcome: 'synced',
          clientMutationId: entry.clientMutationId,
          evaluationId: entry.evaluationId,
          expectedVersion: entry.expectedVersion,
          serverVersion: entry.expectedVersion + 1,
          payloadDigest: entry.payloadDigest,
          acknowledgedAt: now.toISOString(),
        };
      },
    });
    synchronizer.start();
    await vi.waitFor(() => expect(sends).toBe(1));
    synchronizer.stop();
    synchronizer.start();
    release();
    await vi.waitFor(() => expect(timer).not.toBeNull());
    now = new Date(now.getTime() + 31_000);
    timer!();
    await synchronizer.flush();
    expect(sends).toBe(2);
    await expect(repository.getSyncState(scope)).resolves.toBe('synced');
    synchronizer.stop();
    repository.close();
  });

  it('makes flush inert after stop until an explicit new start generation', async () => {
    const repository = await queuedRepository();
    let sends = 0;
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      send: async (entry) => {
        sends += 1;
        return {
          outcome: 'synced',
          clientMutationId: entry.clientMutationId,
          evaluationId: entry.evaluationId,
          expectedVersion: entry.expectedVersion,
          serverVersion: entry.expectedVersion + 1,
          payloadDigest: entry.payloadDigest,
          acknowledgedAt: new Date().toISOString(),
        };
      },
    });
    synchronizer.start();
    await synchronizer.flush();
    synchronizer.stop();
    await repository.enqueueEvaluationMutation({
      scope,
      evaluationId,
      expectedVersion: 1,
      draft: { scores: [{ categoryId, value: 5 }], noteTagIds: [], flags: [] },
    });
    await synchronizer.flush();
    expect(sends).toBe(1);
    expect((await repository.listMutations(scope)).some((row) => row.status === 'pending')).toBe(
      true,
    );
    synchronizer.start();
    await synchronizer.flush();
    expect(sends).toBe(2);
    synchronizer.stop();
    repository.close();
  });

  it('does not misclassify a local acknowledgement failure as a network failure', async () => {
    const repository = await queuedRepository();
    vi.spyOn(repository, 'acknowledgeMutation').mockRejectedValue(new Error('local write failed'));
    const failure = vi.spyOn(repository, 'recordMutationFailure');
    const synchronizer = new EvaluationSynchronizer({
      repository,
      scope,
      send: async (entry) => ({
        outcome: 'synced',
        clientMutationId: entry.clientMutationId,
        evaluationId: entry.evaluationId,
        expectedVersion: entry.expectedVersion,
        serverVersion: entry.expectedVersion + 1,
        payloadDigest: entry.payloadDigest,
        acknowledgedAt: '2026-08-29T12:00:00.000Z',
      }),
    });
    const events: string[] = [];
    synchronizer.subscribe((event) => events.push(`${event.state}:${event.category}`));
    await expect(synchronizer.flush()).rejects.toThrow('local write failed');
    expect(failure).not.toHaveBeenCalled();
    expect(events).toEqual(['needs_attention:corrupt_record']);
    repository.close();
  });

  it('lets only one tab send a FIFO head through the shared lease', async () => {
    const databaseName = `sync-tabs-${crypto.randomUUID()}`;
    const firstRepository = await queuedRepository(databaseName);
    const secondRepository = createEvaluationOfflineRepository({
      authenticatedUserId: scope.userId,
      databaseName,
    });
    let requests = 0;
    const send = async (entry: Awaited<ReturnType<typeof firstRepository.nextPendingMutation>>) => {
      if (!entry) throw new Error('missing entry');
      requests += 1;
      return {
        outcome: 'synced' as const,
        clientMutationId: entry.clientMutationId,
        evaluationId: entry.evaluationId,
        expectedVersion: entry.expectedVersion,
        serverVersion: entry.expectedVersion + 1,
        payloadDigest: entry.payloadDigest,
        acknowledgedAt: '2026-08-29T12:00:00.000Z',
      };
    };
    await Promise.all([
      new EvaluationSynchronizer({ repository: firstRepository, scope, send }).flush(),
      new EvaluationSynchronizer({ repository: secondRepository, scope, send }).flush(),
    ]);
    expect(requests).toBe(1);
    await expect(firstRepository.getSyncState(scope)).resolves.toBe('synced');
    firstRepository.close();
    secondRepository.close();
  });
});
