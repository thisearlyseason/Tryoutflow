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

const authorization = (overrides: Record<string, unknown> = {}) => ({
  data: {
    outcome: 'authorized',
    send_attempt_token: '44444444-4444-4444-8444-444444444444',
    send_budget_ms: 45_000,
    ...overrides,
  },
  error: null,
});

afterEach(() => vi.useRealTimers());

describe('communication dispatch fencing', () => {
  it('reauthorizes immediately before provider submission and skips cancelled sources', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { outcome: 'cancelled' }, error: null });
    const provider = { send: vi.fn() } satisfies EmailProvider;
    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('cancelled');
    expect(rpc).toHaveBeenCalledWith('authorize_outbox_job_send_v2', expect.any(Object));
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('records a stalled provider as exact delivery uncertainty without scheduling a retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const leasedJob = job();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(authorization())
      .mockResolvedValueOnce({ data: 'needs_attention', error: null });
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
    await expect(dispatch).resolves.toBe('needs_attention');
    expect(send).toHaveBeenCalledWith(
      expect.any(Object),
      leasedJob.providerIdempotencyKey,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(rpc).toHaveBeenLastCalledWith(
      'record_outbox_job_delivery_uncertain_v2',
      expect.objectContaining({
        p_send_attempt_token: '44444444-4444-4444-8444-444444444444',
      }),
    );
    expect(rpc).not.toHaveBeenCalledWith('fail_outbox_job_v2', expect.any(Object));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not record provider failure after a lost completion response', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(authorization())
      .mockResolvedValueOnce({ data: null, error: { code: 'network' } });
    const provider = {
      send: vi
        .fn()
        .mockResolvedValue({ providerMessageId: '55555555-5555-4555-8555-555555555555' }),
    } satisfies EmailProvider;
    await expect(dispatchJob({ rpc }, provider, job())).rejects.toThrow('completion_failed');
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith('fail_outbox_job_v2', expect.any(Object));
  });

  it('does not use the app wall clock to pre-judge a database lease', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: { outcome: 'insufficient_budget', send_attempt_token: null, send_budget_ms: 0 },
      error: null,
    });
    const provider = { send: vi.fn() } satisfies EmailProvider;
    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('retry_scheduled');
    expect(provider.send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'authorize_outbox_job_send_v2',
      expect.objectContaining({ p_provider_timeout_ms: 45_000, p_safety_margin_ms: 15_000 }),
    );
  });

  it('releases an authorized handoff as known-not-sent when authorization consumes the lease budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    const leasedJob = {
      ...job(),
      leaseExpiresAt: new Date('2026-08-30T12:01:00.000Z').toISOString(),
    };
    const rpc = vi.fn(async (name: string) => {
      if (name === 'authorize_outbox_job_send_v2') {
        vi.setSystemTime(new Date('2026-08-30T12:00:45.500Z'));
        return authorization();
      }
      if (name === 'decline_outbox_job_send_v2') return { data: 'retry_scheduled', error: null };
      return { data: null, error: new Error('unexpected RPC') };
    });
    const provider = { send: vi.fn() } satisfies EmailProvider;

    const monotonicNow = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(45_500);
    await expect(dispatchJob({ rpc }, provider, leasedJob, { monotonicNow })).resolves.toBe(
      'retry_scheduled',
    );
    expect(provider.send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith(
      'decline_outbox_job_send_v2',
      expect.objectContaining({
        p_job_id: leasedJob.jobId,
        p_lease_token: leasedJob.leaseToken,
        p_lease_generation: leasedJob.leaseGeneration,
        p_send_attempt_token: '44444444-4444-4444-8444-444444444444',
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
      .mockImplementationOnce(async () => authorization())
      .mockImplementationOnce(async () => ({ data: 'retry_scheduled', error: null }));
    const provider = { send: vi.fn() } satisfies EmailProvider;
    const monotonicNow = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(45_500);

    await expect(dispatchJob({ rpc }, provider, leasedJob, { monotonicNow })).resolves.toBe(
      'retry_scheduled',
    );
    expect(provider.send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith('decline_outbox_job_send_v2', expect.any(Object));
  });

  it('reports durable delivery uncertainty when reauthorization finds an invalid source after handoff', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { outcome: 'needs_attention' }, error: null });
    const provider = { send: vi.fn() } satisfies EmailProvider;

    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('needs_attention');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('reports durable delivery uncertainty when a started retry reaches its attempt limit', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(authorization())
      .mockResolvedValueOnce({ data: 'needs_attention', error: null });
    const provider = new FakeTemporaryProvider();

    await expect(
      dispatchJob({ rpc }, provider, { ...job(), attemptCount: 5, maxAttempts: 5 }),
    ).resolves.toBe('needs_attention');
  });

  it('routes an adapter delivery-uncertain result to the exact fenced uncertainty transition', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(authorization())
      .mockResolvedValueOnce({ data: 'needs_attention', error: null });
    const provider = {
      send: vi.fn().mockRejectedValue({ code: 'delivery_uncertain', retryable: false }),
    } satisfies EmailProvider;

    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('needs_attention');
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith(
      'record_outbox_job_delivery_uncertain_v2',
      expect.objectContaining({
        p_job_id: job().jobId,
        p_lease_token: job().leaseToken,
        p_lease_generation: job().leaseGeneration,
        p_send_attempt_token: '44444444-4444-4444-8444-444444444444',
      }),
    );
    expect(rpc).not.toHaveBeenCalledWith('fail_outbox_job_v2', expect.any(Object));
  });

  it('does not send when another routine already owns the exact authorization', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: { outcome: 'in_progress', send_attempt_token: null, send_budget_ms: 0 },
      error: null,
    });
    const provider = { send: vi.fn() } satisfies EmailProvider;

    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('needs_attention');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('subtracts authorization round-trip elapsed time from the database send budget', async () => {
    vi.useFakeTimers();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(authorization({ send_budget_ms: 45_000 }))
      .mockResolvedValueOnce({ data: 'needs_attention', error: null });
    const send = vi.fn(
      (_message, _key, options?: { signal?: AbortSignal }) =>
        new Promise<{ providerMessageId: string }>((resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
          setTimeout(
            () => resolve({ providerMessageId: '55555555-5555-4555-8555-555555555555' }),
            44_000,
          );
        }),
    );
    const monotonicNow = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(1_100);

    const dispatch = dispatchJob({ rpc }, { send }, job(), { monotonicNow });
    await vi.advanceTimersByTimeAsync(43_751);
    await expect(dispatch).resolves.toBe('needs_attention');
    expect(rpc).toHaveBeenLastCalledWith(
      'record_outbox_job_delivery_uncertain_v2',
      expect.objectContaining({ p_send_attempt_token: '44444444-4444-4444-8444-444444444444' }),
    );
  });

  it.each(['resolve', 'reject'] as const)(
    'records uncertainty at the deadline and ignores a provider that ignores abort then %ss late',
    async (lateOutcome) => {
      vi.useFakeTimers();
      const rpc = vi
        .fn()
        .mockResolvedValueOnce(authorization())
        .mockResolvedValueOnce({ data: 'needs_attention', error: null });
      let settleProvider!: () => void;
      const send = vi.fn(
        (
          _message: { to: string; subject: string; text: string },
          _key: string,
          _options?: { signal?: AbortSignal },
        ) =>
          new Promise<{ providerMessageId: string }>((resolve, reject) => {
            settleProvider = () => {
              if (lateOutcome === 'resolve') {
                resolve({ providerMessageId: '55555555-5555-4555-8555-555555555555' });
              } else {
                reject(new Error('late provider failure'));
              }
            };
          }),
      );
      let settled = false;
      const dispatch = dispatchJob({ rpc }, { send }, job()).then((outcome) => {
        settled = true;
        return outcome;
      });

      await vi.advanceTimersByTimeAsync(45_001);
      expect(settled).toBe(true);
      await expect(dispatch).resolves.toBe('needs_attention');
      expect(send.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).toHaveBeenLastCalledWith(
        'record_outbox_job_delivery_uncertain_v2',
        expect.objectContaining({ p_send_attempt_token: '44444444-4444-4444-8444-444444444444' }),
      );

      settleProvider();
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(rpc).not.toHaveBeenCalledWith('complete_outbox_job_v2', expect.any(Object));
      expect(rpc).not.toHaveBeenCalledWith('fail_outbox_job_v2', expect.any(Object));
    },
  );

  it('records an unsupported provider identifier as delivery uncertainty after the send', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(authorization())
      .mockResolvedValueOnce({ data: 'needs_attention', error: null });
    const provider = {
      send: vi.fn().mockResolvedValue({
        providerMessageId: '66666666-6666-6666-8666-666666666666',
      }),
    } satisfies EmailProvider;

    await expect(dispatchJob({ rpc }, provider, job())).resolves.toBe('needs_attention');
    expect(rpc).toHaveBeenLastCalledWith(
      'record_outbox_job_delivery_uncertain_v2',
      expect.any(Object),
    );
    expect(rpc).not.toHaveBeenCalledWith('complete_outbox_job_v2', expect.any(Object));
  });
});

class FakeTemporaryProvider implements EmailProvider {
  async send(): Promise<never> {
    throw { code: 'provider_temporary', retryable: true };
  }
}
