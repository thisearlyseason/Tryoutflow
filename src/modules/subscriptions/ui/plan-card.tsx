'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/button';
import { isValidBillingSessionUrl } from '../../../infrastructure/billing/provider-session-url';
import type { PaidPlanKey } from '../domain/plans';

type DisplayPlan = Readonly<{
  key: PaidPlanKey;
  name: string;
  monthlyPriceCad: number;
}>;

async function requestCheckout(organizationId: string, plan: PaidPlanKey) {
  const clientAttemptId = crypto.randomUUID();
  const response = await fetch(`/api/organizations/${organizationId}/billing/checkout`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan, clientAttemptId }),
  });
  const body = (await response.json()) as unknown;
  if (
    response.status === 409 &&
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    body.error === 'checkout_in_progress'
  )
    throw new Error('checkout_in_progress');
  if (
    !response.ok ||
    typeof body !== 'object' ||
    body === null ||
    !('url' in body) ||
    typeof body.url !== 'string' ||
    !('sessionId' in body) ||
    typeof body.sessionId !== 'string' ||
    !isValidBillingSessionUrl(body.sessionId, body.url, 'checkout')
  )
    throw new Error('checkout_unavailable');
  return body.url;
}

export function PlanCard({
  disabled = false,
  organizationId,
  plan,
  globallyBusy = false,
  onBusyChange,
}: {
  disabled?: boolean;
  organizationId: string;
  plan: DisplayPlan;
  globallyBusy?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'conflict'>('idle');
  const actionRef = useRef<HTMLButtonElement>(null);
  const checkoutInFlight = useRef(false);

  useEffect(() => {
    if (state === 'error' || state === 'conflict') actionRef.current?.focus();
  }, [state]);

  async function choosePlan() {
    if (checkoutInFlight.current || state === 'loading' || disabled || globallyBusy) return;
    checkoutInFlight.current = true;
    setState('loading');
    onBusyChange?.(true);
    try {
      window.location.assign(await requestCheckout(organizationId, plan.key));
    } catch (error) {
      checkoutInFlight.current = false;
      setState(
        error instanceof Error && error.message === 'checkout_in_progress' ? 'conflict' : 'error',
      );
      onBusyChange?.(false);
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
        ref={actionRef}
        busy={state === 'loading'}
        className="mt-5 w-full"
        disabled={disabled || globallyBusy}
        onClick={(event) => {
          if (event.detail > 1) return;
          void choosePlan();
        }}
      >
        {state === 'loading' ? `Opening ${plan.name} checkout…` : `Choose ${plan.name}`}
      </Button>
      <p aria-live="polite" className="mt-2 min-h-6 text-sm text-[var(--color-destructive)]">
        {state === 'conflict'
          ? 'Another checkout is already in progress for this organization. Finish it or try again shortly.'
          : state === 'error'
            ? 'Checkout could not be opened. Nothing was changed. Please try again.'
            : ''}
      </p>
    </article>
  );
}
