import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
const findAuthorizationContext = vi.hoisted(() => vi.fn());
const sync = vi.hoisted(() => vi.fn());

vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getUser } })),
}));
vi.mock('../../../src/modules/organizations/infrastructure/membership-repository', () => ({
  SupabaseMembershipRepository: class {
    findAuthorizationContext = findAuthorizationContext;
  },
}));
vi.mock('../../../src/modules/evaluations/application/sync-evaluation-mutation', async (load) => {
  const actual =
    await load<
      typeof import('../../../src/modules/evaluations/application/sync-evaluation-mutation')
    >();
  return { ...actual, syncEvaluationMutation: sync };
});

import { POST } from '../../../src/app/api/evaluations/[evaluationId]/mutations/route';

const evaluationId = '73000000-0000-4000-8000-000000000001';
const userId = '73000000-0000-4000-8000-000000000002';
const validBody = {
  scope: {
    userId,
    evaluatorId: userId,
    organizationId: '73000000-0000-4000-8000-000000000003',
    tryoutId: '73000000-0000-4000-8000-000000000005',
    sessionId: '73000000-0000-4000-8000-000000000006',
    registrationId: '73000000-0000-4000-8000-000000000007',
    rubricVersionId: '73000000-0000-4000-8000-000000000008',
  },
  clientMutationId: '73000000-0000-4000-8000-000000000004',
  expectedVersion: 0,
  draft: { scores: [], noteTagIds: [], flags: [] },
};

describe('evaluation mutation route', () => {
  beforeEach(() => {
    getUser.mockReset();
    findAuthorizationContext.mockReset();
    sync.mockReset();
  });

  it.each([
    [
      'cross origin',
      { origin: 'https://attacker.example', 'content-type': 'application/json' },
      403,
    ],
    ['wrong MIME', { origin: 'http://localhost', 'content-type': 'text/plain' }, 415],
  ])('rejects %s before authentication', async (_name, headers, status) => {
    const response = await POST(
      new Request(`http://localhost/api/evaluations/${evaluationId}/mutations`, {
        method: 'POST',
        headers,
        body: '{}',
      }) as never,
      { params: Promise.resolve({ evaluationId }) },
    );
    expect(response.status).toBe(status);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('binds the path ID and authenticated actor instead of trusting body identity', async () => {
    getUser.mockResolvedValue({ data: { user: { id: userId } } });
    const actor = { organizationId: '73000000-0000-4000-8000-000000000003' };
    findAuthorizationContext.mockResolvedValue(actor);
    sync.mockResolvedValue({
      ok: true,
      value: {
        outcome: 'synced',
        clientMutationId: '73000000-0000-4000-8000-000000000004',
        evaluationId,
        expectedVersion: 0,
        payloadDigest: 'a'.repeat(64),
        serverVersion: 1,
        acknowledgedAt: '2026-08-29T12:00:00.000Z',
      },
    });
    const response = await POST(
      new Request(`http://localhost/api/evaluations/${evaluationId}/mutations`, {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: {
            userId,
            evaluatorId: userId,
            organizationId: actor.organizationId,
            tryoutId: '73000000-0000-4000-8000-000000000005',
            sessionId: '73000000-0000-4000-8000-000000000006',
            registrationId: '73000000-0000-4000-8000-000000000007',
            rubricVersionId: '73000000-0000-4000-8000-000000000008',
          },
          clientMutationId: '73000000-0000-4000-8000-000000000004',
          expectedVersion: 0,
          draft: { scores: [], noteTagIds: [], flags: [] },
        }),
      }) as never,
      { params: Promise.resolve({ evaluationId }) },
    );
    expect(response.status).toBe(200);
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ evaluationId }), actor);
  });

  it('keeps unexpected authentication/storage failures retryable', async () => {
    getUser.mockRejectedValue(new Error('temporary auth service failure'));
    const response = await POST(
      new Request(`http://localhost/api/evaluations/${evaluationId}/mutations`, {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      }) as never,
      { params: Promise.resolve({ evaluationId }) },
    );
    expect(response.status).toBe(503);
  });

  it('caps a streamed body without trusting content-length', async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128 * 1_024 + 1));
        controller.close();
      },
    });
    const request = new Request(`http://localhost/api/evaluations/${evaluationId}/mutations`, {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: oversized,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const response = await POST(request as never, {
      params: Promise.resolve({ evaluationId }),
    });
    expect(response.status).toBe(413);
    expect(getUser).not.toHaveBeenCalled();
  });
});
