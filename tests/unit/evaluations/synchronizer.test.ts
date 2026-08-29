import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import { createEvaluationOfflineRepository } from '../../../src/modules/evaluations/offline/repository';
import { EvaluationSynchronizer } from '../../../src/modules/evaluations/offline/synchronizer';

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
    await expect(synchronizer.flush()).rejects.toThrow('local write failed');
    expect(failure).not.toHaveBeenCalled();
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
