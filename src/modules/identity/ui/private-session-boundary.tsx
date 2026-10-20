'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
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
  useEffect(() => {
    const client = createBrowserSupabaseClient();
    let active = true;
    let generation = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    function lock() {
      generation += 1;
      if (!active) return;
      setVerifiedUserId(null);
      router.replace(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    async function verify() {
      const observed = ++generation;
      setVerifiedUserId(null);
      try {
        const { data, error } = await client.auth.getUser();
        if (!active || generation !== observed) return;
        if (error || data.user?.id !== userId) lock();
        else setVerifiedUserId(userId);
      } catch {
        if (active && generation === observed) lock();
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
    const resume = () => {
      void verify();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visible);
    void verify();
    return () => {
      active = false;
      generation += 1;
      clearTimeout(expiry);
      subscription.unsubscribe();
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [router, userId]);
  return verifiedUserId !== userId ? (
    <p role="status">Sign in to continue to your private workspace.</p>
  ) : (
    children
  );
}
