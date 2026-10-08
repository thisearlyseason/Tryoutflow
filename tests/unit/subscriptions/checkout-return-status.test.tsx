import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkoutReturnStatus } from '@/modules/subscriptions/application/checkout-return-status';
import { billingDashboardSchema } from '@/modules/subscriptions/domain/billing-dashboard';
import { BILLING_PRODUCT_KEYS } from '@/modules/subscriptions/domain/billing-products';
import { resolveEffectiveEntitlements } from '@/modules/subscriptions/domain/effective-entitlements';
import {
  checkoutConfirmed,
  useCheckoutReturn,
} from '@/modules/subscriptions/ui/use-checkout-return';
import { BillingDashboardPanel } from '@/modules/subscriptions/ui/billing-dashboard';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/modules/subscriptions/ui/billing-analytics', () => ({ trackBilling: vi.fn() }));
const org = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const event = '33333333-3333-4333-8333-333333333333';
const intentId = '44444444-4444-5444-a444-444444444444';
const contractId = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-10-08T00:00:00.000Z');
const input = { organizationId: org, purchaserId: owner, intentId, now };
function ledger(
  product: (typeof BILLING_PRODUCT_KEYS)[number] = 'single_tryout_pro',
): Parameters<typeof checkoutReturnStatus>[0] {
  const single = product === 'single_tryout_pro';
  return {
    intents: [
      {
        id: intentId,
        organization_id: org,
        purchaser_id: owner,
        provider: 'stripe' as const,
        product_key: product,
        tryout_id: single ? event : null,
        created_at: '2026-10-07T00:00:00.000Z',
        expires_at: '2026-10-07T01:00:00.000Z',
        contract_id: contractId,
        provider_session_id: 'cs_test_synthetic',
      },
    ],
    contracts: [
      {
        id: contractId,
        organization_id: org,
        purchaser_id: owner,
        provider: 'stripe' as const,
        environment: 'sandbox' as const,
        provider_contract_id: single ? 'pi_synthetic' : 'sub_synthetic',
        provider_customer_id: 'cus_synthetic',
        product_key: product,
        tryout_id: single ? event : null,
        status: 'active' as const,
        current_period_start: '2026-10-07T00:00:00.000Z',
        current_period_end: single ? null : '2026-11-07T00:00:00.000Z',
        grace_period_end: null,
        cancel_at_period_end: false,
        pending_product_key: null,
        downgrade_effective_at: null,
        observed_at: '2026-10-07T00:01:00.000Z',
      },
    ],
  };
}
function dashboard(checkout?: ReturnType<typeof checkoutReturnStatus>) {
  return billingDashboardSchema.parse({
    access: resolveEffectiveEntitlements({ organizationId: org, grants: [], now }),
    subscriptions: ledger().contracts,
    overrides: [],
    history: [],
    usage: { active_tryouts: 1 },
    ...(checkout ? { checkout } : {}),
  });
}
let initial: ReturnType<typeof dashboard>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  initial = dashboard();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('owner ledger purchase identity', () => {
  it.each(BILLING_PRODUCT_KEYS)(
    'confirms only the exact consumed intent for %s even after intent expiry',
    (product) => {
      const result = checkoutReturnStatus(ledger(product), input);
      expect(result).toEqual({ intentId, status: 'confirmed' });
      expect(checkoutConfirmed(dashboard(result), intentId)).toBe(true);
      expect(checkoutConfirmed(dashboard(result), owner)).toBe(false);
    },
  );
  it('a paid Single Tryout confirms while organization-wide access stays Free', () => {
    const value = dashboard(checkoutReturnStatus(ledger(), input));
    expect(value.access.plan).toBe('free');
    expect(value.access.source).toBe('free');
    expect(checkoutConfirmed(value, intentId)).toBe(true);
  });
  it('manual Pro and an unrelated existing Single Tryout do not confirm a pending intent', () => {
    const value = dashboard();
    value.access.plan = 'pro';
    value.access.source = 'manual';
    expect(checkoutConfirmed(value, intentId)).toBe(false);
    const context = ledger();
    context.intents[0]!.contract_id = null;
    context.intents[0]!.expires_at = '2026-10-08T01:00:00.000Z';
    expect(checkoutReturnStatus(context, input).status).toBe('pending');
  });
  it.each([
    { organization_id: owner },
    { purchaser_id: org },
    { product_key: 'pro_annual' },
    { tryout_id: owner },
    { provider: 'apple' },
    { id: owner },
    { current_period_start: '2026-11-01T00:00:00.000Z' },
    { status: 'refunded' },
    { status: 'paused' },
    { status: 'incomplete' },
    { status: 'expired' },
  ])('does not confirm mismatched or inactive contract %j', (change) => {
    const context = ledger();
    Object.assign(context.contracts[0]!, change);
    expect(checkoutReturnStatus(context, input).status).toBe('unavailable');
  });
  it.each([
    { organization_id: owner },
    { purchaser_id: org },
    { provider: 'apple' },
    { tryout_id: null },
  ])('does not accept mismatched intent %j', (change) => {
    const context = ledger();
    Object.assign(context.intents[0]!, change);
    expect(checkoutReturnStatus(context, input).status).toBe('unavailable');
  });
  it('rejects ambiguous matching contracts and malformed expiry instead of guessing', () => {
    const context = ledger();
    context.contracts.push({ ...context.contracts[0]! });
    expect(checkoutReturnStatus(context, input).status).toBe('unavailable');
    context.contracts = [];
    context.intents[0]!.contract_id = null;
    context.intents[0]!.expires_at = 'invalid';
    expect(checkoutReturnStatus(context, input).status).toBe('unavailable');
  });
  it('expired unpaid intent cannot confirm existing access or revive a purchase', () => {
    const context = ledger();
    context.intents[0]!.contract_id = null;
    expect(checkoutReturnStatus(context, input).status).toBe('expired');
    expect(checkoutReturnStatus(context, { ...input, intentId: owner }).status).toBe('unavailable');
  });
  it('scheduled cancellation retains confirmation only to the paid period end', () => {
    const context = ledger('pro_monthly');
    context.contracts[0]!.cancel_at_period_end = true;
    expect(checkoutReturnStatus(context, input).status).toBe('confirmed');
    expect(
      checkoutReturnStatus(context, { ...input, now: new Date('2026-11-07T00:00:00.000Z') }).status,
    ).toBe('unavailable');
  });
});
describe('bounded ledger-only checkout return and cancel', () => {
  it('polls exact intent with GET, confirms delayed Single payment, and confirms again after reload', async () => {
    const pending = dashboard({ intentId, status: 'pending' });
    const confirmed = dashboard(checkoutReturnStatus(ledger(), input));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(pending))
      .mockImplementation(() => Promise.resolve(Response.json(confirmed)));
    vi.stubGlobal('fetch', fetcher);
    const { result, unmount } = renderHook(() => useCheckoutReturn(pending, org, true, intentId));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('checking');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.status).toBe('confirmed');
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe(`/api/organizations/${org}/billing/actions?intent=${intentId}`);
      expect(options).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      expect(options.body).toBeUndefined();
    }
    unmount();
    const reload = renderHook(() => useCheckoutReturn(initial, org, true, intentId));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reload.result.current.status).toBe('confirmed');
  });
  it.each([401, 403])('denies authorization status %s without retry', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status }));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(initial, org, true, intentId));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.status).toBe('denied');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['organization', 'intent'])('rejects cross-%s responses', async (scope) => {
    const wrong = dashboard({
      intentId: scope === 'intent' ? owner : intentId,
      status: 'confirmed',
    });
    if (scope === 'organization') wrong.access.organizationId = owner;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(wrong)));
    const { result } = renderHook(() => useCheckoutReturn(initial, org, true, intentId));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('denied');
  });
  it.each(['confirmed', 'expired', 'unavailable'] as const)(
    'ignores stale %s status and accepts only a fresh confirmation',
    async (status) => {
      const stale = dashboard({ intentId, status });
      stale.access.evaluatedAt = '2026-10-07T23:59:59.000Z';
      const fresh = dashboard({ intentId, status: 'confirmed' });
      fresh.access.evaluatedAt = '2026-10-08T00:00:02.000Z';
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(Response.json(stale))
        .mockResolvedValueOnce(Response.json(fresh));
      vi.stubGlobal('fetch', fetcher);
      const { result } = renderHook(() => useCheckoutReturn(initial, org, true, intentId));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.status).toBe('checking');
      expect(result.current.dashboard).toEqual(initial);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.status).toBe('confirmed');
      expect(result.current.dashboard).toEqual(fresh);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it('older initial confirmation cannot override newer local access after reload', async () => {
    const old = dashboard({ intentId, status: 'confirmed' });
    old.access.evaluatedAt = '2026-10-07T23:59:59.000Z';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => {})),
    );
    const { result, rerender } = renderHook(
      ({ value }) => useCheckoutReturn(value, org, true, intentId),
      { initialProps: { value: initial } },
    );
    const newest = dashboard({ intentId, status: 'unavailable' });
    newest.access.evaluatedAt = '2026-10-08T00:00:01.000Z';
    act(() => result.current.setDashboard(newest));
    rerender({ value: old });
    expect(result.current.status).toBe('checking');
    expect(result.current.dashboard).toEqual(newest);
  });
  it('missing or malformed identity never confirms unrelated paid access and does no polling', async () => {
    const paid = dashboard();
    paid.access.plan = 'pro';
    paid.access.source = 'manual';
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(paid, org, true, null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('stops at original30sec deadline even if transport ignores abort', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useCheckoutReturn(initial, org, true, intentId));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(result.current.status).toBe('pending');
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  });
  it('late response after organization/intent changes or unmount cannot replace current state', async () => {
    let release!: (response: Response) => void;
    const old = new Promise<Response>((accept) => {
      release = accept;
    });
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockResolvedValue(Response.json(dashboard({ intentId: owner, status: 'pending' })));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender, unmount } = renderHook(
      ({ id }) => useCheckoutReturn(initial, org, true, id),
      { initialProps: { id: intentId } },
    );
    rerender({ id: owner });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      release(Response.json(dashboard({ intentId, status: 'confirmed' })));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('checking');
    unmount();
    const count = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('renders explicit cancelled status with unchanged ledger and no payment polling or write', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    render(
      <BillingDashboardPanel
        initial={dashboard()}
        organizationId={org}
        products={[]}
        tryouts={[]}
        analyticsEnabled={false}
        checkoutCancelled
        checkoutIntentId={intentId}
      />,
    );
    expect(screen.getByLabelText('Checkout status')).toHaveTextContent(
      'Checkout was cancelled. Your current access is shown below.',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
