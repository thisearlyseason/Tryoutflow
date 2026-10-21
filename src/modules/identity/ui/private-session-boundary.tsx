'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { createBrowserSupabaseClient } from '@/infrastructure/supabase/client';

/** Server routes authorize first; this removes stale UI when that browser session ends. */
export function PrivateSessionBoundary({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [waitingForConnection, setWaitingForConnection] = useState(false);
  const retryVerification = useRef<(() => void) | null>(null);
  useEffect(() => {
    const client = createBrowserSupabaseClient();
    let active = true;
    let generation = 0;
    let departing = false;
    let retryOnConnection = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function lock() {
      retryOnConnection = false;
      setWaitingForConnection(false);
      generation += 1;
      if (!active) return;
      setVerifiedUserId(null);
      if (departing) return;
      router.replace(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    function unavailable(error: unknown) {
      if (!isAuthRetryableFetchError(error) || error.status !== 0) return false;
      // A transport failure is not proof of logout. Stay masked on this
      // route; only a fresh successful getUser may restore private children.
      retryOnConnection = true;
      setWaitingForConnection(true);
      return true;
    }
    async function verify() {
      if (departing) return;
      const observed = ++generation;
      retryOnConnection = false;
      setWaitingForConnection(false);
      setVerifiedUserId(null);
      try {
        const { data, error } = await client.auth.getUser();
        if (!active || generation !== observed) return;
        if (error) {
          if (!unavailable(error)) lock();
        } else if (data.user?.id !== userId) lock();
        else setVerifiedUserId(userId);
      } catch (error) {
        if (active && generation === observed && !unavailable(error)) lock();
      }
    }
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      clearTimeout(expiry);
      if (
        !session ||
        session.user.id !== userId ||
        !session.expires_at ||
        session.expires_at * 1000 <= Date.now()
      )
        lock();
      else expiry = setTimeout(lock, session.expires_at * 1000 - Date.now());
    });
    const depart = () => {
      departing = true;
      generation += 1;
      setVerifiedUserId(null);
    };
    const resume = () => {
      departing = false;
      void verify();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    // A canceled navigation stays masked until a visible lifecycle event or
    // trusted interaction requests fresh authority. Never guess with a timer.
    const interact = (event: Event) => {
      if (departing && event.isTrusted && document.visibilityState === 'visible') resume();
    };
    const reconnect = () => {
      if (retryOnConnection && !departing && document.visibilityState === 'visible') void verify();
    };
    retryVerification.current = () => {
      if (retryOnConnection && !departing && document.visibilityState === 'visible') void verify();
    };
    window.addEventListener('online', reconnect);
    window.addEventListener('beforeunload', depart);
    window.addEventListener('pagehide', depart);
    document.addEventListener('pointerdown', interact);
    document.addEventListener('keydown', interact);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visible);
    void verify();
    return () => {
      active = false;
      retryVerification.current = null;
      generation += 1;
      clearTimeout(expiry);
      subscription.unsubscribe();
      window.removeEventListener('online', reconnect);
      window.removeEventListener('beforeunload', depart);
      window.removeEventListener('pagehide', depart);
      document.removeEventListener('pointerdown', interact);
      document.removeEventListener('keydown', interact);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [router, userId]);
  return verifiedUserId !== userId ? (
    <div>
      <p role="status">
        {waitingForConnection
          ? 'Reconnect to verify your session and continue to your private workspace.'
          : 'Sign in to continue to your private workspace.'}
      </p>
      {waitingForConnection && (
        <button type="button" onClick={() => retryVerification.current?.()}>
          Retry session verification
        </button>
      )}
    </div>
  ) : (
    children
  );
}
