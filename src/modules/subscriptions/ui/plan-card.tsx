'use client';

import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import type { PaidPlanKey } from '../domain/plans';

type DisplayPlan = Readonly<{
  key: PaidPlanKey;
  name: string;
  monthlyPriceCad: number;
}>;

async function requestCheckout(organizationId: string, plan: PaidPlanKey) {
  const response = await fetch(`/api/organizations/${organizationId}/billing/checkout`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  const body = (await response.json()) as unknown;
  if (
    !response.ok ||
    typeof body !== 'object' ||
    body === null ||
    !('url' in body) ||
    typeof body.url !== 'string' ||
    new URL(body.url).protocol !== 'https:'
  )
    throw new Error('checkout_unavailable');
  return body.url;
}

export function PlanCard({
  disabled = false,
  organizationId,
  plan,
}: {
  disabled?: boolean;
  organizationId: string;
  plan: DisplayPlan;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function choosePlan() {
    if (state === 'loading' || disabled) return;
    setState('loading');
    try {
      window.location.assign(await requestCheckout(organizationId, plan.key));
    } catch {
      setState('error');
    }
  }

  return (
    <article className="flex min-w-0 flex-col rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-surface)]">
      <h3 className="text-xl font-black">{plan.name}</h3>
      <p className="mt-3">
        <span className="font-[family-name:var(--font-score)] text-3xl font-black">
          ${plan.monthlyPriceCad}
        </span>{' '}
        <span className="text-[var(--color-text-muted)]">CAD / month</span>
      </p>
      <p className="mt-2 flex-1 text-sm text-[var(--color-text-muted)]">
        Provider confirmation updates access after the verified webhook is processed.
      </p>
      <Button
        busy={state === 'loading'}
        className="mt-5 w-full"
        disabled={disabled}
        onClick={() => void choosePlan()}
      >
        {state === 'loading' ? `Opening ${plan.name} checkout…` : `Choose ${plan.name}`}
      </Button>
      <p aria-live="polite" className="mt-2 min-h-6 text-sm text-[var(--color-destructive)]">
        {state === 'error'
          ? 'Checkout could not be opened. Nothing was changed. Please try again.'
          : ''}
      </p>
    </article>
  );
}
