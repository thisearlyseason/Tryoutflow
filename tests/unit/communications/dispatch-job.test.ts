// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmailProvider } from '../../../src/infrastructure/email/email-provider';
import type { ClaimedEmailJob } from '../../../src/infrastructure/jobs/claim-jobs';
import { dispatchJob } from '../../../src/infrastructure/jobs/dispatch-job';

const job = (): ClaimedEmailJob => ({
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
});

afterEach(() => vi.useRealTimers());

describe('communication dispatch fencing', () => {
  it('reauthorizes immediately before provider submission and skips cancelled sources', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 'cancelled', error: null });
    const provider = { send: vi.fn() } satisfies EmailProvider;
    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('cancelled');
    expect(rpc).toHaveBeenCalledWith('authorize_outbox_job_send', expect.any(Object));
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('aborts a stalled provider before the lease safety margin and schedules a stable-key retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const leasedJob = job();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'authorized', error: null })
      .mockResolvedValueOnce({ data: 'retry_scheduled', error: null });
    const send = vi.fn(
      (_message, _key, options?: { signal?: AbortSignal }) =>
        new Promise<{ providerMessageId: string }>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const dispatch = dispatchJob({ rpc }, { send }, leasedJob);
    await vi.advanceTimersByTimeAsync(45_001);
    await expect(dispatch).resolves.toBe('retry_scheduled');
    expect(send).toHaveBeenCalledWith(
      expect.any(Object),
      leasedJob.providerIdempotencyKey,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'fail_outbox_job',
      expect.objectContaining({ p_error_code: 'provider_temporary', p_retryable: true }),
    );
  });

  it('does not record provider failure after a lost completion response', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'authorized', error: null })
      .mockResolvedValueOnce({ data: null, error: { code: 'network' } });
    const provider = {
      send: vi
        .fn()
        .mockResolvedValue({ providerMessageId: '55555555-5555-4555-8555-555555555555' }),
    } satisfies EmailProvider;
    await expect(dispatchJob({ rpc }, provider, job())).rejects.toThrow('completion_failed');
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith('fail_outbox_job', expect.any(Object));
  });

  it('does not start a provider request after the lease safety deadline', async () => {
    const nearlyExpired = { ...job(), leaseExpiresAt: new Date(Date.now() + 15_500).toISOString() };
    const rpc = vi.fn().mockResolvedValueOnce({ data: 'retry_scheduled', error: null });
    const provider = { send: vi.fn() } satisfies EmailProvider;
    await expect(dispatchJob({ rpc }, provider, nearlyExpired)).resolves.toBe('retry_scheduled');
    expect(provider.send).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('authorize_outbox_job_send', expect.any(Object));
  });

  it('releases an authorized handoff as known-not-sent when authorization consumes the lease budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const leasedJob = {
      ...job(),
      leaseExpiresAt: new Date('2026-08-30T12:01:00.000Z').toISOString(),
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === 'authorize_outbox_job_send') {
        vi.setSystemTime(new Date('2026-08-30T12:00:45.500Z'));
        return { data: 'authorized', error: null };
      }
      if (name === 'decline_outbox_job_send') return { data: 'retry_scheduled', error: null };
      return { data: null, error: new Error('unexpected RPC') };
    });
    const provider = { send: vi.fn() } satisfies EmailProvider;

    await expect(dispatchJob({ rpc }, provider, leasedJob)).resolves.toBe('retry_scheduled');
    expect(provider.send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith(
      'decline_outbox_job_send',
      expect.objectContaining({
        p_job_id: leasedJob.jobId,
        p_lease_token: leasedJob.leaseToken,
        p_lease_generation: leasedJob.leaseGeneration,
        p_reason: 'provider_deadline_elapsed',
      }),
    );
  });

  it('checks the clock again immediately before invoking the provider', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const leasedJob = {
      ...job(),
      leaseExpiresAt: new Date('2026-08-30T12:01:00.000Z').toISOString(),
    };
    const rpc = vi
      .fn()
      .mockImplementationOnce(async () => ({ data: 'authorized', error: null }))
      .mockImplementationOnce(async () => ({ data: 'retry_scheduled', error: null }));
    const provider = { send: vi.fn() } satisfies EmailProvider;
    const dateNow = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(new Date('2026-08-30T12:00:00.000Z').valueOf())
      .mockReturnValueOnce(new Date('2026-08-30T12:00:45.500Z').valueOf());

    await expect(dispatchJob({ rpc }, provider, leasedJob)).resolves.toBe('retry_scheduled');
    expect(provider.send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith('decline_outbox_job_send', expect.any(Object));
    dateNow.mockRestore();
  });

  it('reports durable delivery uncertainty when reauthorization finds an invalid source after handoff', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 'needs_attention', error: null });
    const provider = { send: vi.fn() } satisfies EmailProvider;

    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('needs_attention');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('reports durable delivery uncertainty when a started retry reaches its attempt limit', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'authorized', error: null })
      .mockResolvedValueOnce({ data: 'needs_attention', error: null });
    const provider = new FakeTemporaryProvider();

    await expect(
      dispatchJob({ rpc }, provider, { ...job(), attemptCount: 5, maxAttempts: 5 }),
    ).resolves.toBe('needs_attention');
  });
});

class FakeTemporaryProvider implements EmailProvider {
  async send(): Promise<never> {
    throw { code: 'provider_temporary', retryable: true };
  }
}
