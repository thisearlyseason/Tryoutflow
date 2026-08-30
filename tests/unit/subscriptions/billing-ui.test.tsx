import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlanCard } from '../../../src/modules/subscriptions/ui/plan-card';
import { SubscriptionStatus } from '../../../src/modules/subscriptions/ui/subscription-status';

describe('billing UI', () => {
  it('renders the centralized launch plans and prices', () => {
    render(
      <div>
        <PlanCard
          organizationId="11111111-1111-4111-8111-111111111111"
          plan={{ key: 'team', name: 'Team', monthlyPriceCad: 49 }}
        />
        <PlanCard
          organizationId="11111111-1111-4111-8111-111111111111"
          plan={{ key: 'club', name: 'Club', monthlyPriceCad: 129 }}
        />
        <PlanCard
          organizationId="11111111-1111-4111-8111-111111111111"
          plan={{ key: 'association', name: 'Association', monthlyPriceCad: 249 }}
        />
      </div>,
    );
    expect(screen.getByRole('heading', { name: 'Team' })).toBeVisible();
    expect(screen.getByText('$49')).toBeVisible();
    expect(screen.getByText('$129')).toBeVisible();
    expect(screen.getByText('$249')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /choose/i })).toHaveLength(3);
  });

  it('reports active, past-due, scheduled-cancel, and canceled state without granting access', () => {
    const { rerender } = render(
      <SubscriptionStatus
        account={{
          plan: 'club',
          state: 'active',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          cancelAt: null,
          canceledAt: null,
          trialEnd: null,
          hasVerifiedCustomer: true,
        }}
        organizationId="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Club plan active');
    expect(screen.getByText(/Current period ends/u)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeVisible();

    rerender(
      <SubscriptionStatus
        account={{
          plan: 'club',
          state: 'past_due',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          cancelAt: null,
          canceledAt: null,
          trialEnd: null,
          hasVerifiedCustomer: true,
        }}
        organizationId="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Payment needs attention');
    expect(screen.getByRole('status')).toHaveTextContent('Publishing is paused');

    rerender(
      <SubscriptionStatus
        account={{
          plan: 'club',
          state: 'active',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          cancelAtPeriodEnd: true,
          cancelAt: '2026-10-01T00:00:00.000Z',
          canceledAt: null,
          trialEnd: null,
          hasVerifiedCustomer: true,
        }}
        organizationId="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Scheduled to cancel');

    rerender(
      <SubscriptionStatus
        account={{
          plan: 'club',
          state: 'canceled',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
          cancelAtPeriodEnd: false,
          cancelAt: null,
          canceledAt: '2026-09-10T00:00:00.000Z',
          trialEnd: null,
          hasVerifiedCustomer: true,
        }}
        organizationId="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Subscription canceled');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Existing tryout records remain available',
    );
  });
});
