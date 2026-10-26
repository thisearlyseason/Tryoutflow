import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCheckoutReturn } from '@/modules/subscriptions/ui/use-checkout-return';
import { resolveEffectiveEntitlements } from '@/modules/subscriptions/domain/effective-entitlements';
import type { BillingDashboard } from '@/modules/subscriptions/domain/billing-dashboard';
const id = '11111111-1111-4111-8111-111111111111';
const intentId = '33333333-3333-4333-8333-333333333333';
const free: BillingDashboard = {
  access: resolveEffectiveEntitlements({
    organizationId: id,
    grants: [],
    now: new Date('2026-10-04T00:00:00Z'),
  }),
  subscriptions: [],
  overrides: [],
  history: [],
  usage: { active_tryouts: 0 },
  checkout: { intentId, status: 'pending' },
};
const paid: BillingDashboard = {
  ...free,
  checkout: { intentId, status: 'confirmed' },
  access: {
    ...free.access,
    plan: 'pro',
    source: 'organization_subscription',
    evaluatedAt: '2026-10-04T00:00:02Z',
  },
  subscriptions: [
    {
      id,
      tryout_id: null,
      product_key: 'pro_monthly',
      provider: 'stripe',
      status: 'active',
      current_period_start: '2026-10-04T00:00:01Z',
      current_period_end: '2026-11-04T00:00:01Z',
      cancel_at_period_end: false,
      pending_product_key: null,
      downgrade_effective_at: null,
    },
  ],
};
const response = (value: BillingDashboard) => ({ ok: true, status: 200, json: async () => value });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('checkout return', () => {
  it('handles webhook before redirect without provider calls', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(paid, id, true, intentId));
    expect(result.current.status).toBe('confirmed');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('handles delayed webhook with only same-origin GETs', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response(free)).mockResolvedValue(response(paid));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(free, id, true, intentId));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.status).toBe('confirmed');
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const call of fetcher.mock.calls) {
      expect(call[0]).toBe(`/api/organizations/${id}/billing/actions?intent=${intentId}`);
      expect(call[1]).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
    }
  });
  it('bounds offline reads and supports a read-only retry', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new Error('Offline'));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(free, id, true, intentId));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31000);
    });
    expect(result.current.status).toBe('pending');
    const calls = fetcher.mock.calls.length;
    fetcher.mockResolvedValue(response(paid));
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.status).toBe('confirmed');
    expect(fetcher).toHaveBeenCalledTimes(calls + 1);
  });
  it('stops on authentication denial', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(free, id, true, intentId));
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-organization responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          ...paid,
          access: { ...paid.access, organizationId: '22222222-2222-4222-8222-222222222222' },
        }),
      ),
    );
    const { result } = renderHook(() => useCheckoutReturn(free, id, true, intentId));
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(result.current.dashboard.access.plan).toBe('free');
  });
  it('does not regress a newer read when refreshed props are stale', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(paid)));
    const { result, rerender } = renderHook(
      ({ initial }) => useCheckoutReturn(initial, id, true, intentId),
      {
        initialProps: { initial: free },
      },
    );
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
    rerender({ initial: { ...free } });
    expect(result.current.dashboard.access.plan).toBe('pro');
  });
  it('does not poll ordinary billing navigation', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderHook(() => useCheckoutReturn(free, id, false, intentId));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts interrupted reads and ignores late responses', async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const { result, unmount } = renderHook(() => useCheckoutReturn(free, id, true, intentId));
    const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(response(paid));
    });
    expect(result.current.dashboard.access.plan).toBe('free');
  });
  it('handles Back/Forward and repeated return using GET only', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(paid));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(
      ({ complete }) => useCheckoutReturn(free, id, complete, intentId),
      { initialProps: { complete: true } },
    );
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
    rerender({ complete: false });
    expect(result.current.status).toBe('idle');
    rerender({ complete: true });
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
    expect(result.current.dashboard.checkout).toEqual({ intentId, status: 'confirmed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(
      `/api/organizations/${id}/billing/actions?intent=${intentId}`,
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });
  it('reads a different valid intent before confirming a repeated checkout return', async () => {
    const nextIntentId = '55555555-5555-4555-8555-555555555555';
    let finishNextRead!: (value: ReturnType<typeof response>) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(paid))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNextRead = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(
      ({ intent }) => useCheckoutReturn(free, id, true, intent),
      { initialProps: { intent: intentId } },
    );
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
    rerender({ intent: nextIntentId });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(result.current.status).toBe('checking');
    expect(result.current.dashboard.checkout?.intentId).toBe(intentId);
    await act(async () => {
      finishNextRead(
        response({ ...paid, checkout: { intentId: nextIntentId, status: 'confirmed' } }),
      );
    });
    expect(result.current.status).toBe('confirmed');
    expect(result.current.dashboard.checkout?.intentId).toBe(nextIntentId);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `/api/organizations/${id}/billing/actions?intent=${intentId}`,
      `/api/organizations/${id}/billing/actions?intent=${nextIntentId}`,
    ]);
    for (const call of fetcher.mock.calls)
      expect(call[1]).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
  });
  it('rejects the old confirmed ledger when a different intent is requested', async () => {
    const nextIntentId = '55555555-5555-4555-8555-555555555555';
    const fetcher = vi.fn().mockResolvedValue(response(paid));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(
      ({ intent }) => useCheckoutReturn(free, id, true, intent),
      { initialProps: { intent: intentId } },
    );
    await waitFor(() => expect(result.current.status).toBe('confirmed'));
    rerender({ intent: nextIntentId });
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]![0]).toBe(
      `/api/organizations/${id}/billing/actions?intent=${nextIntentId}`,
    );
    for (const call of fetcher.mock.calls)
      expect(call[1]).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
  });
  it.each([null, 'not-an-intent'])(
    'rejects missing or invalid checkout intent %s without reading',
    (intent) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      const { result } = renderHook(() => useCheckoutReturn(paid, id, true, intent));
      expect(result.current.status).toBe('unavailable');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('does not confirm paid access without matching intent ledger confirmation', async () => {
    const subscriptionWithoutIntent: BillingDashboard = { ...paid, checkout: undefined };
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ ...free, checkout: { intentId, status: 'pending' } }));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() =>
      useCheckoutReturn(subscriptionWithoutIntent, id, true, intentId),
    );
    expect(result.current.status).not.toBe('confirmed');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe('checking');
  });
  it('rejects a different intent ledger without granting access', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        ...paid,
        checkout: { intentId: '44444444-4444-4444-8444-444444444444', status: 'confirmed' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(free, id, true, intentId));
    await waitFor(() => expect(result.current.status).toBe('denied'));
    expect(result.current.dashboard.access.plan).toBe('free');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
