'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { createBrowserSupabaseClient } from '@/infrastructure/supabase/client';
import { ProductBrandBar } from '@/components/layout/product-brand-bar';

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
  const [signInHref, setSignInHref] = useState('/sign-in');
  const retryVerification = useRef<(() => void) | null>(null);
  useEffect(() => {
    setSignInHref(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
    const client = createBrowserSupabaseClient();
    let active = true;
    let generation = 0;
    let departing = false;
    let retryOnConnection = false;
    let denied = false;
    let needsExpiryProof = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function lock() {
      denied = true;
      retryOnConnection = false;
      setWaitingForConnection(false);
      generation += 1;
      if (!active) return;
      setVerifiedUserId(null);
      if (departing) return;
      if (navigator.onLine === false) {
        retryOnConnection = true;
        setWaitingForConnection(true);
        return;
      }
      const destination = `/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`;
      setSignInHref(destination);
      router.replace(destination);
    }
    function waitForConnection() {
      if (denied) return;
      needsExpiryProof = true;
      generation += 1;
      setVerifiedUserId(null);
      retryOnConnection = true;
      setWaitingForConnection(true);
    }
    function expire() {
      // Expiry never authorizes cached content. An offline document stays masked
      // until fresh online proof, rather than navigating to a browser error page.
      if (navigator.onLine === false) waitForConnection();
      else lock();
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
      if (departing || denied) return;
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
        else {
          if (needsExpiryProof) {
            // getUser is the fresh authority. getSession is used only to restore
            // expiry timing, never as a substitute for that server verification.
            const current = await client.auth.getSession();
            if (!active || generation !== observed) return;
            if (current.error) {
              if (!unavailable(current.error)) lock();
              return;
            }
            const session = current.data.session;
            if (
              !session ||
              session.user.id !== userId ||
              !session.expires_at ||
              session.expires_at * 1000 <= Date.now()
            ) {
              lock();
              return;
            }
            clearTimeout(expiry);
            expiry = setTimeout(expire, session.expires_at * 1000 - Date.now());
            needsExpiryProof = false;
          }
          setVerifiedUserId(userId);
        }
      } catch (error) {
        if (active && generation === observed && !unavailable(error)) lock();
      }
    }
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!active || denied) return;
      clearTimeout(expiry);
      if (event === 'INITIAL_SESSION' && !session && navigator.onLine === false) {
        // The SDK also emits INITIAL_SESSION null after a transport failure.
        // This is not a logout signal; require fresh proof when back online.
        waitForConnection();
      } else if (!session || session.user.id !== userId || !session.expires_at) {
        lock();
      } else if (session.expires_at * 1000 <= Date.now()) {
        expire();
      } else expiry = setTimeout(expire, session.expires_at * 1000 - Date.now());
    });
    const depart = () => {
      departing = true;
      generation += 1;
      setVerifiedUserId(null);
    };
    const resume = () => {
      departing = false;
      if (denied) lock();
      else void verify();
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
      if (retryOnConnection && !departing && document.visibilityState === 'visible') {
        if (denied) lock();
        else void verify();
      }
    };
    retryVerification.current = () => {
      if (retryOnConnection && !departing && document.visibilityState === 'visible') {
        if (denied) lock();
        else void verify();
      }
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
    <main className="organization-entry">
      <section className="organization-entry-panel" aria-labelledby="private-session-heading">
        <ProductBrandBar label="Secure workspace" />
        <div className="organization-entry-content">
          <header className="organization-entry-intro">
            <h1 id="private-session-heading">Your private workspace</h1>
            <p role="status">
              {waitingForConnection
                ? 'Reconnect to verify your session and continue to your private workspace.'
                : 'Sign in to continue to your private workspace.'}
            </p>
          </header>
          {waitingForConnection ? (
            <button
              className="button-primary"
              type="button"
              onClick={() => retryVerification.current?.()}
            >
              Retry session verification
            </button>
          ) : (
            <a className="button-primary" href={signInHref}>
              Sign in
            </a>
          )}
        </div>
      </section>
    </main>
  ) : (
    children
  );
}
