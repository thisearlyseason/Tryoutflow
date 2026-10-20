'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Match sign-in's margin before the provider's five-minute token expiry.
const TOKEN_SUBMISSION_WINDOW_MS = 270_000;

export function useBotProtectedSubmission(deterministicToken?: string) {
  const [ready, setReady] = useState(Boolean(deterministicToken));
  const [pending, setPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const submitting = useRef(false);
  const verifiedAt = useRef<number | null>(null);
  const rememberVerification = useCallback((token: string) => {
    verifiedAt.current = token ? Date.now() : null;
  }, []);

  useEffect(() => {
    function restore(event: PageTransitionEvent) {
      if (!event.persisted) return;
      submitting.current = false;
      verifiedAt.current = null;
      setPending(false);
      setReady(Boolean(deterministicToken));
      setResetKey((value) => value + 1);
    }
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, [deterministicToken]);

  function canSubmit() {
    if (!ready || submitting.current) return false;
    if (
      !deterministicToken &&
      (verifiedAt.current === null || Date.now() - verifiedAt.current >= TOKEN_SUBMISSION_WINDOW_MS)
    ) {
      verifiedAt.current = null;
      setReady(false);
      setResetKey((value) => value + 1);
      return false;
    }
    return true;
  }

  function markSubmitted() {
    submitting.current = true;
    setPending(true);
  }

  return {
    ready,
    pending,
    resetKey,
    onReadyChange: setReady,
    onTokenChange: rememberVerification,
    canSubmit,
    markSubmitted,
  };
}
