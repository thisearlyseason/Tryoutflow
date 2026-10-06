import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/organizations/[organizationId]/billing/plan-change/route';
const mocks = vi.hoisted(() => ({
  owner: vi.fn(),
  context: vi.fn(),
  preview: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  reconcile: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/modules/subscriptions/application/billing-request', () => ({
  ownerBillingContext: mocks.owner,
}));
vi.mock('@/modules/subscriptions/application/billing-service', () => ({
  providerContext: mocks.context,
  reconcileOrganizationSubscription: mocks.reconcile,
}));
vi.mock('@/modules/subscriptions/providers/stripe', () => ({ stripeBillingClient: () => ({}) }));
vi.mock('@/modules/subscriptions/providers/stripe-plan-change', () => ({
  PlanChangeConflict: class extends Error {},
  previewStripePlanChange: mocks.preview,
  scheduleStripePlanChange: mocks.schedule,
  cancelStripePlanChange: mocks.cancel,
}));
const org = '11111111-1111-4111-8111-111111111111';
const contract = {
  organization_id: org,
  provider: 'stripe',
  status: 'active',
  tryout_id: null,
  current_period_end: '2099-01-01T00:00:00Z',
};
const invoke = (body: unknown) =>
  POST(
    new Request('https://www.tryout.agency/api/organizations/' + org + '/billing/plan-change', {
      method: 'POST',
      headers: { Origin: 'https://www.tryout.agency', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ organizationId: org }) },
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner.mockResolvedValue({ client: { rpc: mocks.rpc }, isNative: false });
  mocks.context.mockResolvedValue({ contracts: [contract] });
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
  mocks.preview.mockResolvedValue({ quote: { product: 'pro_annual' } });
});
describe('web plan change boundary', () => {
  it('requires owner authorization before provider access', async () => {
    mocks.owner.mockRejectedValue(new Error('forbidden'));
    expect((await invoke({ action: 'preview', product: 'pro_annual' })).ok).toBe(false);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('rejects native web-billing requests', async () => {
    mocks.owner.mockResolvedValue({ isNative: true });
    expect((await invoke({ action: 'preview', product: 'pro_annual' })).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each([
    [],
    [contract, contract],
    [{ ...contract, provider: 'apple' }],
    [{ ...contract, status: 'past_due' }],
  ])('rejects missing, ambiguous, native or unpaid contracts', async (...args) => {
    mocks.context.mockResolvedValue({ contracts: args });
    expect((await invoke({ action: 'preview', product: 'pro_annual' })).status).toBe(409);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('does not activate disabled provider configuration', async () => {
    mocks.context.mockRejectedValue(new Error('billing_not_enabled'));
    expect((await invoke({ action: 'preview', product: 'pro_annual' })).ok).toBe(false);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('preview cannot mutate a subscription', async () => {
    expect((await invoke({ action: 'preview', product: 'pro_annual' })).status).toBe(200);
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('rejects unrecognized products and malformed confirmations', async () => {
    for (const body of [
      { action: 'preview', product: 'single_tryout_pro' },
      { action: 'confirm', product: 'pro_annual', token: 'bad' },
    ])
      expect((await invoke(body)).ok).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('reconciles provider truth after confirmation before returning access', async () => {
    const body = {
      action: 'confirm',
      product: 'pro_annual',
      token: 'a'.repeat(64),
      attemptId: org,
    };
    expect((await invoke(body)).status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith({}, contract, 'pro_annual', body.token, org);
    expect(mocks.reconcile).toHaveBeenCalledWith(org);
    expect(mocks.rpc).toHaveBeenCalledWith('get_billing_dashboard', { p_organization_id: org });
  });
});
