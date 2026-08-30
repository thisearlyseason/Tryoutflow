// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { processJobsRequest } from '../../../src/app/api/jobs/process/route';

const secret = 's'.repeat(40);
const request = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://tryoutflow.example/api/jobs/process', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });

describe('job processor route security', () => {
  it.each([
    ['missing secret', request('{}', { authorization: '' }), 401],
    ['wrong secret', request('{}', { authorization: `Bearer ${'x'.repeat(40)}` }), 401],
    ['cross origin', request('{}', { origin: 'https://attacker.example' }), 403],
    ['wrong MIME', request('{}', { 'content-type': 'text/plain' }), 415],
    ['oversized body', request(JSON.stringify({ padding: 'x'.repeat(5_000) })), 413],
  ])('rejects %s', async (_name, incoming, status) => {
    const claim = vi.fn();
    const response = await processJobsRequest(incoming, { secret, claim, dispatch: vi.fn() });
    expect(response.status).toBe(status);
    expect(claim).not.toHaveBeenCalled();
  });

  it('bounds the batch, dispatches claims, and returns content-free diagnostics', async () => {
    const job = {
      jobId: '11111111-1111-4111-8111-111111111111',
      messageId: '22222222-2222-4222-8222-222222222222',
      leaseToken: '33333333-3333-4333-8333-333333333333',
      leaseGeneration: 1,
      leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(),
      providerIdempotencyKey: 'communication:22222222-2222-4222-8222-222222222222',
      recipientEmail: 'private@example.com',
      subject: 'Private subject',
      bodyText: 'Private body',
      attemptCount: 1,
      maxAttempts: 5,
    };
    const claim = vi.fn().mockResolvedValue([job]);
    const dispatch = vi.fn().mockResolvedValue('completed');
    const purgeExpiredPreviews = vi.fn().mockResolvedValue(undefined);
    const response = await processJobsRequest(request('{"batchSize":2}'), {
      secret,
      claim,
      dispatch,
      purgeExpiredPreviews,
    });
    expect(response.status).toBe(200);
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 2 }));
    expect(dispatch).toHaveBeenCalledWith(job);
    expect(purgeExpiredPreviews).toHaveBeenCalledOnce();
    const text = await response.text();
    expect(text).toContain('"completed":1');
    expect(text).not.toMatch(/private|subject|body|recipient/iu);
  });

  it('counts delivery uncertainty separately from cancellation and failure', async () => {
    const response = await processJobsRequest(request('{}'), {
      secret,
      claim: vi.fn().mockResolvedValue([
        {
          jobId: '11111111-1111-4111-8111-111111111111',
          messageId: '22222222-2222-4222-8222-222222222222',
          leaseToken: '33333333-3333-4333-8333-333333333333',
          leaseGeneration: 1,
          leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(),
          providerIdempotencyKey: 'communication:22222222-2222-4222-8222-222222222222',
          recipientEmail: 'private@example.com',
          subject: 'Private subject',
          bodyText: 'Private body',
          attemptCount: 5,
          maxAttempts: 5,
        },
      ]),
      dispatch: vi.fn().mockResolvedValue('needs_attention'),
    });

    await expect(response.json()).resolves.toMatchObject({
      needsAttention: 1,
      cancelled: 0,
      failed: 0,
    });
  });
});
