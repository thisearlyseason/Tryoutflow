'use client';
import { useEffect, useState } from 'react';
import { billingDashboardSchema, type BillingDashboard } from '../domain/billing-dashboard';

export function checkoutConfirmed(value: BillingDashboard) {
  return (
    value.access.source !== 'trial' &&
    value.access.plan !== 'free' &&
    value.subscriptions.some(
      (subscription) =>
        ['active', 'grace_period'].includes(subscription.status) &&
        (!subscription.current_period_end ||
          Date.parse(subscription.current_period_end) > Date.parse(value.access.evaluatedAt)),
    )
  );
}

// Reads the authenticated owner's ledger only; never reconciles with a provider or purchases.
export function useCheckoutReturn(
  initial: BillingDashboard,
  organizationId: string,
  complete: boolean,
) {
  const [dashboard, setDashboard] = useState(initial);
  const [status, setStatus] = useState<'idle' | 'checking' | 'confirmed' | 'pending' | 'denied'>(
    complete ? 'checking' : 'idle',
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setDashboard((previous) =>
      previous.access.organizationId !== organizationId ||
      Date.parse(initial.access.evaluatedAt) >= Date.parse(previous.access.evaluatedAt)
        ? initial
        : previous,
    );
  }, [initial, organizationId]);
  useEffect(() => {
    if (!complete) {
      setStatus('idle');
      return;
    }
    if (checkoutConfirmed(initial)) {
      setStatus('confirmed');
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const deadline = Date.now() + 30_000;
    setStatus('checking');
    async function read() {
      if (disposed) return;
      if (Date.now() >= deadline) {
        setStatus('pending');
        return;
      }
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), Math.min(5_000, deadline - Date.now()));
      try {
        const response = await fetch(`/api/organizations/${organizationId}/billing/actions`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (disposed) return;
        if (response.status === 401 || response.status === 403) {
          setStatus('denied');
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const next = billingDashboardSchema.parse(await response.json());
        if (disposed) return;
        if (next.access.organizationId !== organizationId) {
          setStatus('denied');
          return;
        }
        setDashboard(next);
        if (checkoutConfirmed(next)) {
          setStatus('confirmed');
          return;
        }
      } catch {
        /* A transient read failure is retried within the bounded window. */
      } finally {
        clearTimeout(timeout);
      }
      if (disposed) return;
      if (Date.now() >= deadline) {
        setStatus('pending');
        return;
      }
      timer = setTimeout(read, Math.min(2_000, deadline - Date.now()));
    }
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [complete, organizationId, initial, attempt]);
  return { dashboard, setDashboard, status, retry: () => setAttempt((value) => value + 1) };
}
