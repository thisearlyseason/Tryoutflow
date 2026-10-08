import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  loadStripeSnapshot,
  stripeChargeSnapshots,
} from '@/modules/subscriptions/providers/stripe';

// All provider calls are synthetic; no Stripe or database connection is made.
const mocks = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  invoices: { list: vi.fn(), retrieve: vi.fn() },
  charges: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  disputes: { list: vi.fn() },
  invoicePayments: { list: vi.fn() },
  checkout: { sessions: { retrieve: vi.fn(), list: vi.fn() } },
}));
vi.mock('stripe', () => ({
  default: class {
    subscriptions = mocks.subscriptions;
    invoices = mocks.invoices;
    charges = mocks.charges;
    paymentIntents = mocks.paymentIntents;
    disputes = mocks.disputes;
    invoicePayments = mocks.invoicePayments;
    checkout = mocks.checkout;
  },
}));

const owner = '11111111-1111-4111-8111-111111111111';
const priorStart = Date.parse('2026-09-08T00:00:00Z') / 1000;
const priorEnd = Date.parse('2026-10-08T00:00:00Z') / 1000;
const renewalEnd = Date.parse('2026-11-08T00:00:00Z') / 1000;
const priorInvoice = {
  id: 'in_prior_paid_fixture',
  status: 'paid',
  parent: { subscription_details: { subscription: 'sub_fixture' } },
  lines: {
    data: [
      {
        amount: 4900,
        pricing: { price_details: { price: 'price_pro_fixture' } },
        period: { start: priorStart, end: priorEnd },
      },
    ],
  },
};
const renewalInvoice = {
  ...priorInvoice,
  id: 'in_paid_renewal_fixture',
  lines: {
    data: [
      {
        ...priorInvoice.lines.data[0]!,
        period: { start: priorEnd, end: renewalEnd },
      },
    ],
  },
};

function paymentStates(prior: { refunded: boolean; disputed: boolean }) {
  mocks.invoicePayments.list.mockImplementation(
    async (input: { invoice?: string; payment?: unknown }) => {
      if (input.payment) return { has_more: false, data: [{ invoice: priorInvoice.id }] };
      if (input.invoice === 'in_unpaid_renewal_fixture') return { has_more: false, data: [] };
      if (input.invoice === priorInvoice.id || input.invoice === renewalInvoice.id)
        return {
          has_more: false,
          data: [
            {
              payment: {
                payment_intent:
                  input.invoice === priorInvoice.id ? 'pi_prior_fixture' : 'pi_renewal_fixture',
              },
            },
          ],
        };
      throw new Error('Unexpected synthetic payment read');
    },
  );
  mocks.paymentIntents.retrieve.mockImplementation(async (id: string) => {
    if (id === 'pi_prior_fixture') return { latest_charge: { id: 'ch_prior_fixture', ...prior } };
    if (id === 'pi_renewal_fixture')
      return { latest_charge: { id: 'ch_renewal_fixture', refunded: false, disputed: false } };
    throw new Error('Unexpected synthetic payment intent read');
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T00:30:00Z'));
  vi.stubEnv('BILLING_ENVIRONMENT', 'sandbox');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture_only');
  // This is a synthetic policy fixture, not a proposed production grace change.
  vi.stubEnv('STRIPE_GRACE_PERIOD_HOURS', '24');
  for (const [key, price] of [
    ['PRO_MONTHLY', 'price_pro_fixture'],
    ['PRO_ANNUAL', 'price_pro_annual_fixture'],
    ['ORGANIZATION_MONTHLY', 'price_org_fixture'],
    ['ORGANIZATION_ANNUAL', 'price_org_annual_fixture'],
    ['SINGLE_TRYOUT_PRO', 'price_once_fixture'],
  ]) {
    vi.stubEnv(`STRIPE_PRICE_${key}`, price!);
    vi.stubEnv(`STRIPE_LEGACY_PRICES_${key}`, '');
    vi.stubEnv(`REVENUECAT_APPLE_${key}`, '');
    vi.stubEnv(`REVENUECAT_GOOGLE_${key}`, '');
  }
  mocks.subscriptions.retrieve.mockResolvedValue({
    id: 'sub_fixture',
    livemode: false,
    customer: 'cus_fixture',
    metadata: { billing_version: '2', purchaser_id: owner, billing_intent_id: owner },
    status: 'past_due',
    cancel_at_period_end: false,
    cancel_at: null,
    latest_invoice: 'in_unpaid_renewal_fixture',
    items: {
      data: [
        {
          price: { id: 'price_pro_fixture' },
          current_period_start: priorEnd,
          current_period_end: renewalEnd,
        },
      ],
    },
    schedule: null,
  });
  mocks.invoices.list.mockResolvedValue({ data: [priorInvoice] });
  mocks.invoices.retrieve.mockImplementation(async (id: string) => {
    if (id === priorInvoice.id) return priorInvoice;
    throw new Error('Unexpected synthetic invoice read');
  });
  mocks.invoicePayments.list.mockImplementation(
    async (input: { invoice?: string; payment?: unknown }) => {
      if (input.invoice === 'in_unpaid_renewal_fixture') return { has_more: false, data: [] };
      if (input.invoice === priorInvoice.id)
        return { has_more: false, data: [{ payment: { payment_intent: 'pi_prior_fixture' } }] };
      if (input.payment) return { has_more: false, data: [{ invoice: priorInvoice.id }] };
      throw new Error('Unexpected synthetic payment read');
    },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('control: a still-valid paid period retains verified grace when it has no refund or dispute', async () => {
  mocks.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: { id: 'ch_prior_fixture', refunded: false, disputed: false },
  });
  const { snapshot } = await loadStripeSnapshot('sub_fixture');
  expect(snapshot.status).toBe('grace_period');
  expect(snapshot.current_period_end).toBe(new Date(priorEnd * 1000).toISOString());
});

it('with default zero grace, a refunded prior invoice cannot supply an unexpired paid period after a failed change', async () => {
  vi.stubEnv('STRIPE_GRACE_PERIOD_HOURS', '0');
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  const subscription = await mocks.subscriptions.retrieve();
  mocks.subscriptions.retrieve.mockResolvedValue({
    ...subscription,
    items: {
      data: [
        {
          price: { id: 'price_pro_fixture' },
          current_period_start: priorStart,
          current_period_end: priorEnd,
        },
      ],
    },
  });
  mocks.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: { id: 'ch_prior_fixture', refunded: true, disputed: false },
  });
  const { snapshot } = await loadStripeSnapshot('sub_fixture');
  expect(Date.parse(snapshot.current_period_end!)).toBeGreaterThan(Date.now());
  expect(snapshot.grace_period_end).toBeNull();
  expect(snapshot.status).toBe('refunded');
});

it('current Managed protocol also revokes a refunded prior paid period after an unpaid change, with zero grace', async () => {
  vi.stubEnv('STRIPE_GRACE_PERIOD_HOURS', '0');
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  const subscription = await mocks.subscriptions.retrieve();
  mocks.subscriptions.retrieve.mockResolvedValue({
    ...subscription,
    metadata: {
      ...subscription.metadata,
      tax_protocol: 'managed_v1',
      managed_seller_country: 'CA',
    },
    managed_payments: { enabled: true },
    items: {
      data: [
        {
          price: { id: 'price_pro_fixture' },
          current_period_start: priorStart,
          current_period_end: priorEnd,
        },
      ],
    },
  });
  const paid = { ...priorInvoice, automatic_tax: { enabled: true, status: 'complete' } };
  mocks.invoices.list.mockResolvedValue({ data: [paid] });
  mocks.invoices.retrieve.mockImplementation(async (id) =>
    id === priorInvoice.id
      ? paid
      : {
          id,
          status: 'open',
          customer_address: { country: 'CA' },
          automatic_tax: { enabled: true, status: 'complete' },
        },
  );
  mocks.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: { id: 'ch_prior_fixture', refunded: true, disputed: false },
  });
  const { snapshot } = await loadStripeSnapshot('sub_fixture');
  expect(Date.parse(snapshot.current_period_end!)).toBeGreaterThan(Date.now());
  expect(snapshot.grace_period_end).toBeNull();
  expect(snapshot.status).toBe('refunded');
});

it.each([
  { label: 'full refund', refunded: true, disputed: false, dispute: null, expected: 'refunded' },
  {
    label: 'open dispute',
    refunded: false,
    disputed: true,
    dispute: 'needs_response',
    expected: 'paused',
  },
  { label: 'lost dispute', refunded: false, disputed: true, dispute: 'lost', expected: 'refunded' },
])(
  'does not retain prior-period grace after $label while the latest renewal is unpaid',
  async (state) => {
    const charge = {
      id: 'ch_prior_fixture',
      livemode: false,
      customer: 'cus_fixture',
      refunded: state.refunded,
      disputed: state.disputed,
      payment_intent: 'pi_prior_fixture',
    };
    mocks.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge });
    mocks.charges.retrieve.mockResolvedValue(charge);
    mocks.disputes.list.mockResolvedValue({
      has_more: false,
      data: state.dispute ? [{ status: state.dispute }] : [],
    });
    const { snapshot } = await loadStripeSnapshot('sub_fixture');
    expect(snapshot.current_period_end).toBe(new Date(priorEnd * 1000).toISOString());
    expect(snapshot.status).toBe(state.expected);
  },
);

it('a refund callback revokes the paid invoice that actually supplies grace, even though it is not latest', async () => {
  mocks.charges.retrieve.mockResolvedValue({
    id: 'ch_prior_fixture',
    livemode: false,
    customer: 'cus_fixture',
    refunded: true,
    disputed: false,
    payment_intent: 'pi_prior_fixture',
  });
  mocks.paymentIntents.retrieve.mockResolvedValue({
    latest_charge: { id: 'ch_prior_fixture', refunded: true, disputed: false },
  });
  const snapshots = await stripeChargeSnapshots('ch_prior_fixture', 'refunded');
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]?.snapshot.current_period_end).toBe(new Date(priorEnd * 1000).toISOString());
  expect(snapshots[0]?.snapshot.status).toBe('refunded');
});

it.each(['refunded', 'paused', 'active'] as const)(
  'a delayed %s callback for an older invoice cannot revoke a newer paid period',
  async (state) => {
    const subscription = await mocks.subscriptions.retrieve();
    mocks.subscriptions.retrieve.mockResolvedValue({
      ...subscription,
      status: 'active',
      latest_invoice: renewalInvoice.id,
    });
    mocks.charges.retrieve.mockResolvedValue({
      id: 'ch_prior_fixture',
      refunded: state === 'refunded',
      payment_intent: 'pi_prior_fixture',
    });
    paymentStates({ refunded: state === 'refunded', disputed: state === 'paused' });
    const [current] = await stripeChargeSnapshots('ch_prior_fixture', state);
    expect(current?.snapshot).toMatchObject({
      status: 'active',
      current_period_start: new Date(priorEnd * 1000).toISOString(),
      current_period_end: new Date(renewalEnd * 1000).toISOString(),
      purchaser_id: owner,
      grace_period_end: null,
    });
    expect(mocks.invoicePayments.list).toHaveBeenCalledWith({
      invoice: renewalInvoice.id,
      status: 'paid',
      limit: 10,
    });
    expect(mocks.invoices.list).not.toHaveBeenCalled();
    expect(mocks.disputes.list).not.toHaveBeenCalled();
  },
);

it.each([
  { dispute: 'won', delayedState: 'paused' },
  { dispute: 'warning_closed', delayedState: 'refunded' },
] as const)(
  'a delayed revocation cannot undo verified $dispute dispute resolution',
  async ({ dispute, delayedState }) => {
    mocks.charges.retrieve.mockResolvedValue({
      id: 'ch_prior_fixture',
      refunded: false,
      disputed: true,
      payment_intent: 'pi_prior_fixture',
    });
    paymentStates({ refunded: false, disputed: true });
    mocks.disputes.list.mockResolvedValue({ has_more: false, data: [{ status: dispute }] });
    const [current] = await stripeChargeSnapshots('ch_prior_fixture', delayedState);
    expect(current?.snapshot.status).toBe('grace_period');
    expect(current?.snapshot.current_period_end).toBe(new Date(priorEnd * 1000).toISOString());
    expect(mocks.disputes.list).toHaveBeenCalledWith({ charge: 'ch_prior_fixture', limit: 10 });
  },
);

it('timestamps a bounded delayed read before I/O so a newer paid snapshot wins ordering', async () => {
  const oldSubscription = await mocks.subscriptions.retrieve();
  let finishOlder!: (value: typeof oldSubscription) => void;
  const olderResponse = new Promise<typeof oldSubscription>((resolve) => {
    finishOlder = resolve;
  });
  mocks.subscriptions.retrieve
    .mockImplementationOnce(() => olderResponse)
    .mockResolvedValue({
      ...oldSubscription,
      status: 'active',
      latest_invoice: renewalInvoice.id,
    });
  paymentStates({ refunded: true, disputed: false });
  const olderRead = loadStripeSnapshot('sub_fixture');
  const before = Date.now();
  vi.setSystemTime(new Date(before + 1000));
  const newer = await loadStripeSnapshot('sub_fixture');
  finishOlder(oldSubscription);
  const older = await olderRead;
  expect(newer.snapshot.status).toBe('active');
  expect(older.snapshot.status).toBe('refunded');
  expect(Date.parse(older.snapshot.observed_at)).toBe(before);
  expect(Date.parse(newer.snapshot.observed_at)).toBe(before + 1000);
});

it('does not invent a paid period or grace when the failed subscription has no paid invoice', async () => {
  mocks.invoices.list.mockResolvedValue({ data: [] });
  const { snapshot } = await loadStripeSnapshot('sub_fixture');
  expect(snapshot.status).toBe('incomplete');
  expect(snapshot.grace_period_end).toBeNull();
  expect(mocks.paymentIntents.retrieve).not.toHaveBeenCalled();
});

it('zero grace retains only the actual paid-through boundary, never the unpaid renewal period', async () => {
  vi.stubEnv('STRIPE_GRACE_PERIOD_HOURS', '0');
  paymentStates({ refunded: false, disputed: false });
  const { snapshot } = await loadStripeSnapshot('sub_fixture');
  expect(snapshot).toMatchObject({
    status: 'past_due',
    current_period_start: new Date(priorStart * 1000).toISOString(),
    current_period_end: new Date(priorEnd * 1000).toISOString(),
    grace_period_end: null,
  });
  expect(Date.parse(snapshot.current_period_end!)).toBeLessThan(Date.now());
});

it('fails closed when the effective paid invoice has more payment records than the bounded read', async () => {
  mocks.invoicePayments.list.mockResolvedValue({ has_more: true, data: [] });
  await expect(loadStripeSnapshot('sub_fixture')).rejects.toThrow('unsupported_invoice_payments');
});

it('fails closed when the effective paid charge has more disputes than the bounded read', async () => {
  paymentStates({ refunded: false, disputed: true });
  mocks.disputes.list.mockResolvedValue({ has_more: true, data: [{ status: 'won' }] });
  await expect(loadStripeSnapshot('sub_fixture')).rejects.toThrow('unsupported_disputes');
});

it('fails closed when a callback payment maps to more invoices than the bounded read', async () => {
  mocks.charges.retrieve.mockResolvedValue({
    refunded: true,
    payment_intent: 'pi_prior_fixture',
  });
  mocks.invoicePayments.list.mockResolvedValue({ has_more: true, data: [] });
  await expect(stripeChargeSnapshots('ch_prior_fixture', 'refunded')).rejects.toThrow(
    'ambiguous_payment',
  );
});
