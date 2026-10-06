import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BillingDashboardPanel } from '@/modules/subscriptions/ui/billing-dashboard';
import { FeatureGate } from '@/modules/subscriptions/ui/feature-gate';
import { resolveEffectiveEntitlements } from '@/modules/subscriptions/domain/effective-entitlements';
import type { BillingDashboard } from '@/modules/subscriptions/domain/billing-dashboard';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/modules/subscriptions/ui/billing-analytics', () => ({ trackBilling: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const initial: BillingDashboard = {
  access: resolveEffectiveEntitlements({
    organizationId: id,
    grants: [],
    now: new Date('2026-10-10T00:00:00Z'),
  }),
  subscriptions: [
    {
      id,
      tryout_id: null,
      product_key: 'pro_monthly',
      provider: 'apple',
      status: 'active',
      current_period_start: '2026-10-01T00:00:00Z',
      current_period_end: '2026-11-01T00:00:00Z',
      cancel_at_period_end: true,
      pending_product_key: null,
      downgrade_effective_at: null,
    },
  ],
  overrides: [],
  history: [],
  usage: { active_tryouts: 2 },
};
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
describe('billing experience', () => {
  it('previews a web plan change before explicit confirmation and displays the reconciled schedule', async () => {
    const quote = {
      product: 'pro_annual',
      name: 'Pro Annual',
      price: 'USD 149.99',
      interval: 'year',
      effectiveAt: '2026-11-01T00:00:00.000Z',
      token: 'a'.repeat(64),
    };
    const subscription = {
      ...initial.subscriptions[0]!,
      provider: 'stripe' as const,
      cancel_at_period_end: false,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ quote }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          dashboard: {
            ...initial,
            subscriptions: [
              {
                ...subscription,
                pending_product_key: 'pro_annual',
                downgrade_effective_at: quote.effectiveAt,
              },
            ],
          },
          message: 'Plan change scheduled.',
        }),
      });
    vi.stubGlobal('fetch', fetcher);
    render(
      <BillingDashboardPanel
        initial={{ ...initial, subscriptions: [subscription] }}
        organizationId={id}
        products={[
          {
            key: 'pro_annual',
            name: 'Pro Annual',
            price: 'USD 149.99',
            interval: 'year',
            features: [],
          },
        ]}
        tryouts={[]}
        analyticsEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review plan change' }));
    await waitFor(
      () =>
        expect(screen.getByRole('region', { name: 'Review plan change' })).toHaveTextContent(
          'No charge or credit is made today',
        ),
      { timeout: 10000 },
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      action: 'preview',
      product: 'pro_annual',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change at renewal' }));
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: 'Cancel pending plan change' })).toBeVisible(),
      { timeout: 10000 },
    );
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toMatchObject({
      action: 'confirm',
      product: 'pro_annual',
      token: quote.token,
    });
  });
  it('describes the available portal controls without offering unsupported plan changes', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Portal unavailable in this test.' }),
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <BillingDashboardPanel
        initial={{
          ...initial,
          subscriptions: [{ ...initial.subscriptions[0]!, provider: 'stripe' }],
        }}
        organizationId={id}
        products={[
          {
            key: 'pro_annual',
            name: 'Pro Annual',
            price: 'US$149.99',
            interval: 'year',
            features: [],
          },
        ]}
        tryouts={[]}
        analyticsEnabled={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument();
    expect(screen.getByText(/Resume a cancelled subscription/)).toBeVisible();
    expect(screen.queryByText(/Upgrades begin after payment confirmation/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage current subscription' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ action: 'manage' });
  });

  it('explains cancellation and retained data', () => {
    render(
      <BillingDashboardPanel
        initial={initial}
        organizationId={id}
        products={[]}
        tryouts={[]}
        analyticsEnabled={false}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'cancelled and will remain active until November 1, 2026',
    );
    expect(screen.getByText(/Your athletes, evaluations/)).toBeVisible();
    expect(screen.getByText('App Store')).toBeVisible();
  });
  it('shows an explicit payment warning', () => {
    render(
      <BillingDashboardPanel
        initial={{
          ...initial,
          subscriptions: [
            { ...initial.subscriptions[0]!, status: 'past_due', cancel_at_period_end: false },
          ],
        }}
        organizationId={id}
        products={[]}
        tryouts={[]}
        analyticsEnabled={false}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('problem with your subscription payment');
  });
  it('disables repeat submissions while processing and handles failures', async () => {
    let complete!: (value: unknown) => void;
    const fetcher = vi.fn(() => new Promise((resolve) => (complete = resolve)));
    vi.stubGlobal('fetch', fetcher);
    render(
      <BillingDashboardPanel
        initial={initial}
        organizationId={id}
        products={[]}
        tryouts={[]}
        analyticsEnabled={false}
      />,
    );
    const button = screen.getByRole('button', { name: 'Refresh subscription' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    complete({ ok: false, json: async () => ({ error: 'Please try again.' }) });
    await waitFor(() => expect(button).toBeEnabled());
    expect(
      screen.getAllByRole('status').some((e) => e.textContent?.includes('Please try again.')),
    ).toBe(true);
  });
  it('explains paid features with an accessible dismissible dialog', () => {
    render(
      <FeatureGate access={initial.access} feature="player_comparison" billingHref="/billing">
        <p>Private comparison</p>
      </FeatureGate>,
    );
    expect(screen.queryByText('Private comparison')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Explore Pro' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Player comparison is available');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('three-day Pro trial', () => {
  const trialInitial = {
    ...initial,
    subscriptions: [],
    trial: { eligible: true, startsAt: null, expiresAt: null },
  };
  it('starts only after an explicit click and renders the confirmed trial', async () => {
    const now = new Date();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        dashboard: {
          ...trialInitial,
          access: {
            ...initial.access,
            plan: 'pro',
            source: 'trial',
            evaluatedAt: now.toISOString(),
          },
          trial: {
            eligible: false,
            startsAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
          },
        },
        message: 'Trial started.',
      }),
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <BillingDashboardPanel
        initial={trialInitial}
        organizationId={id}
        products={[]}
        tryouts={[]}
        analyticsEnabled={false}
      />,
    );
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start my 7-day Pro trial' }));
    await waitFor(() => expect(screen.getByText('Your Pro trial is active')).toBeVisible());
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ action: 'start_trial' });
    expect(
      screen.queryByRole('button', { name: 'Start my 7-day Pro trial' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/remaining/)).toBeVisible();
  });
  it('explains expiry without offering another trial', () => {
    render(
      <BillingDashboardPanel
        initial={{
          ...trialInitial,
          trial: {
            eligible: false,
            startsAt: '2020-01-01T00:00:00Z',
            expiresAt: '2020-01-04T00:00:00Z',
          },
        }}
        organizationId={id}
        products={[]}
        tryouts={[]}
        analyticsEnabled={false}
      />,
    );
    expect(screen.getByText('Your Pro trial has ended')).toBeVisible();
    expect(screen.getByText(/Choose a paid plan to continue/)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Start my 7-day Pro trial' }),
    ).not.toBeInTheDocument();
  });
});

it('keeps the no-card trial available while hiding disabled payment options', () => {
  render(
    <BillingDashboardPanel
      initial={{
        ...initial,
        subscriptions: [],
        purchasesEnabled: false,
        trial: { eligible: true, startsAt: null, expiresAt: null },
      }}
      organizationId={id}
      products={[
        { key: 'pro_monthly', name: 'Pro', price: '$14.99', interval: 'month', features: [] },
      ]}
      tryouts={[]}
      analyticsEnabled={false}
    />,
  );
  expect(screen.getByRole('button', { name: 'Start my 7-day Pro trial' })).toBeEnabled();
  expect(screen.getByRole('heading', { name: 'Paid plans are coming soon' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Choose plan' })).not.toBeInTheDocument();
});
