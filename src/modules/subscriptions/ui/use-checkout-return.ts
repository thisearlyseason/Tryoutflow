'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { billingDashboardSchema, type BillingDashboard } from '../domain/billing-dashboard';

export function checkoutConfirmed(value: BillingDashboard, intentId: string | null = null) {
  return (
    !!intentId && value.checkout?.intentId === intentId && value.checkout.status === 'confirmed'
  );
}

// Reads the authenticated owner's ledger only; never reconciles with a provider or purchases.
export function useCheckoutReturn(
  initial: BillingDashboard,
  organizationId: string,
  complete: boolean,
  intentId: string | null = null,
) {
  const [dashboard, setDashboard] = useState(initial);
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'confirmed' | 'pending' | 'denied' | 'expired' | 'unavailable'
  >(complete ? 'checking' : 'idle');
  const [attempt, setAttempt] = useState(0);
  const currentDashboard = useRef(initial);
  useEffect(() => {
    currentDashboard.current = dashboard;
  }, [dashboard]);
  useEffect(() => {
    const previous = currentDashboard.current;
    if (
      previous.access.organizationId !== organizationId ||
      Date.parse(initial.access.evaluatedAt) >= Date.parse(previous.access.evaluatedAt)
    ) {
      currentDashboard.current = initial;
      setDashboard(initial);
    }
  }, [initial, organizationId]);
  useEffect(() => {
    if (!complete) {
      setStatus('idle');
      return;
    }
    if (initial.access.organizationId !== organizationId) {
      setStatus('denied');
      return;
    }
    if (!intentId || !z.uuid().safeParse(intentId).success) {
      setStatus('unavailable');
      return;
    }
    if (checkoutConfirmed(currentDashboard.current, intentId)) {
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
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const readDashboard = async () => {
          const response = await fetch(
            `/api/organizations/${organizationId}/billing/actions?intent=${intentId}`,
            {
              method: 'GET',
              credentials: 'same-origin',
              cache: 'no-store',
              signal: controller!.signal,
            },
          );
          if (response.status === 401 || response.status === 403) return null;
          if (!response.ok) throw new Error('Unavailable');
          return billingDashboardSchema.parse(await response.json());
        };
        const next = await Promise.race([
          readDashboard(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => {
                controller?.abort();
                reject(new Error('Unavailable'));
              },
              Math.min(5_000, deadline - Date.now()),
            );
          }),
        ]);
        if (disposed) return;
        if (Date.now() >= deadline) {
          setStatus('pending');
          return;
        }
        if (!next) {
          setStatus('denied');
          return;
        }
        if (next.access.organizationId !== organizationId) {
          setStatus('denied');
          return;
        }
        if (next.checkout && next.checkout.intentId !== intentId) {
          setStatus('denied');
          return;
        }
        if (
          Date.parse(next.access.evaluatedAt) <
          Date.parse(currentDashboard.current.access.evaluatedAt)
        )
          throw new Error('Stale dashboard');
        currentDashboard.current = next;
        setDashboard(next);
        if (checkoutConfirmed(next, intentId)) {
          setStatus('confirmed');
          return;
        }
        if (next.checkout?.status === 'expired' || next.checkout?.status === 'unavailable') {
          setStatus(next.checkout.status);
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
  }, [complete, organizationId, intentId, initial, attempt]);
  return { dashboard, setDashboard, status, retry: () => setAttempt((value) => value + 1) };
}
