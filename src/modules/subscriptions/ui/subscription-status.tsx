'use client';

import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/ui/status-badge';
import type { PlanKey } from '../domain/plans';
import type { SubscriptionState } from '../domain/entitlements';

export type SubscriptionStatusAccount = Readonly<{
  plan: PlanKey | null;
  state: SubscriptionState;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  cancelAt: string | null;
  canceledAt: string | null;
  trialEnd: string | null;
  hasVerifiedCustomer: boolean;
}>;

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

function statusCopy(account: SubscriptionStatusAccount) {
  const name = account.plan
    ? `${account.plan[0]!.toUpperCase()}${account.plan.slice(1)}`
    : 'No recognized';
  if (account.state === 'past_due')
    return {
      label: 'Payment needs attention',
      detail:
        'Publishing is paused. Existing tryout records remain available while billing is resolved.',
      badge: 'callback' as const,
    };
  if (account.state === 'canceled')
    return {
      label: 'Subscription canceled',
      detail: `Existing tryout records remain available.${account.canceledAt ? ` Canceled ${dateLabel(account.canceledAt)}.` : ''}`,
      badge: 'waitlisted' as const,
    };
  if (account.state === 'inactive')
    return {
      label: 'No active subscription',
      detail: 'Choose a plan to publish new tryouts.',
      badge: 'waitlisted' as const,
    };
  if (account.cancelAtPeriodEnd || account.cancelAt)
    return {
      label: 'Scheduled to cancel',
      detail: `Your ${name} plan remains active until ${dateLabel(account.cancelAt ?? account.currentPeriodEnd) ?? 'the provider-confirmed end date'}.`,
      badge: 'callback' as const,
    };
  if (account.state === 'trialing')
    return {
      label: account.plan === 'trial' ? 'Trial active' : `${name} trial active`,
      detail: account.trialEnd
        ? `Trial ends ${dateLabel(account.trialEnd)}.`
        : 'Trial access is active from verified subscription state.',
      badge: 'complete' as const,
    };
  return {
    label: `${name} plan active`,
    detail: account.currentPeriodEnd
      ? `Current period ends ${dateLabel(account.currentPeriodEnd)}.`
      : 'Subscription access is active from verified provider state.',
    badge: 'complete' as const,
  };
}

export function SubscriptionStatus({
  account,
  organizationId,
}: {
  account: SubscriptionStatusAccount;
  organizationId: string;
}) {
  const copy = statusCopy(account);
  const [portalState, setPortalState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function openPortal() {
    if (portalState === 'loading') return;
    setPortalState('loading');
    try {
      const response = await fetch(`/api/organizations/${organizationId}/billing/portal`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientAttemptId: crypto.randomUUID() }),
      });
      const body = (await response.json()) as unknown;
      if (
        !response.ok ||
        typeof body !== 'object' ||
        body === null ||
        !('url' in body) ||
        typeof body.url !== 'string' ||
        (() => {
          const url = new URL(body.url);
          return !(
            url.protocol === 'https:' &&
            url.hostname === 'billing.stripe.com' &&
            url.port === '' &&
            url.username === '' &&
            url.password === '' &&
            url.pathname.startsWith('/p/session/')
          );
        })()
      )
        throw new Error('portal_unavailable');
      window.location.assign(body.url);
    } catch {
      setPortalState('error');
    }
  }

  return (
    <section
      aria-labelledby="subscription-status-heading"
      className="rounded-[var(--radius-surface)] bg-[var(--color-surface-muted)] p-5"
    >
      <h2 className="text-xl font-black" id="subscription-status-heading">
        Current subscription
      </h2>
      <div aria-live="polite" className="mt-3" role="status">
        <StatusBadge status={copy.badge}>{copy.label}</StatusBadge>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{copy.detail}</p>
      </div>
      {account.hasVerifiedCustomer ? (
        <Button
          busy={portalState === 'loading'}
          className="mt-4"
          onClick={() => void openPortal()}
          variant="secondary"
        >
          {portalState === 'loading' ? 'Opening billing portal…' : 'Manage billing'}
        </Button>
      ) : null}
      <p aria-live="polite" className="mt-2 min-h-6 text-sm text-[var(--color-destructive)]">
        {portalState === 'error'
          ? 'The billing portal could not be opened. Nothing was changed. Please try again.'
          : ''}
      </p>
    </section>
  );
}
