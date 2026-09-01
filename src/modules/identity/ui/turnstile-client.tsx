'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

import type { BotAction } from '../application/bot-protection';

type TurnstileConfiguration = {
  action: BotAction;
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  sitekey: string;
};

type TurnstileApi = {
  render(container: HTMLElement, configuration: TurnstileConfiguration): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function TurnstileClientChallenge({
  action,
  deterministicToken,
  onReadyChange,
  resetKey = 0,
  siteKey,
}: {
  action: BotAction;
  deterministicToken?: string;
  onReadyChange?: (ready: boolean) => void;
  resetKey?: number;
  siteKey?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const previousResetKey = useRef(resetKey);
  const readyCallback = useRef(onReadyChange);
  const [providerReady, setProviderReady] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    deterministicToken ? 'ready' : siteKey ? 'loading' : 'error',
  );
  const [token, setToken] = useState(deterministicToken ?? '');

  readyCallback.current = onReadyChange;

  useEffect(() => {
    readyCallback.current?.(Boolean(deterministicToken || token));
  }, [deterministicToken, token]);

  useEffect(
    () => () => {
      readyCallback.current?.(false);
    },
    [],
  );

  useEffect(() => {
    if (!providerReady || !siteKey || deterministicToken || !container.current) return;
    const api = window.turnstile;
    if (!api) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    setToken('');
    let renderedId: string;
    try {
      renderedId = api.render(container.current, {
        sitekey: siteKey,
        action,
        callback(nextToken) {
          if (!nextToken) {
            setToken('');
            setStatus('error');
            return;
          }
          setToken(nextToken);
          setStatus('ready');
        },
        'error-callback'() {
          setToken('');
          setStatus('error');
        },
        'expired-callback'() {
          setToken('');
          setStatus('error');
        },
        'timeout-callback'() {
          setToken('');
          setStatus('error');
        },
      });
    } catch {
      setStatus('error');
      return;
    }
    if (!renderedId) {
      setStatus('error');
      return;
    }
    widgetId.current = renderedId;
    return () => {
      if (widgetId.current === renderedId) widgetId.current = null;
      try {
        api.remove(renderedId);
      } catch {
        // Provider cleanup must never break navigation or form unmounting.
      }
    };
  }, [action, deterministicToken, providerReady, renderAttempt, siteKey]);

  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    if (deterministicToken || !widgetId.current || !window.turnstile) return;
    setToken('');
    setStatus('loading');
    try {
      window.turnstile.reset(widgetId.current);
    } catch {
      setStatus('error');
    }
  }, [deterministicToken, resetKey]);

  function retry() {
    if (!window.turnstile) {
      setStatus('error');
      return;
    }
    setToken('');
    setStatus('loading');
    if (!widgetId.current) {
      if (providerReady) setRenderAttempt((value) => value + 1);
      else setStatus('error');
      return;
    }
    try {
      window.turnstile.reset(widgetId.current);
    } catch {
      setStatus('error');
    }
  }

  if (deterministicToken)
    return <input name="cf-turnstile-response" type="hidden" value={deterministicToken} />;
  if (!siteKey) return <p role="alert">Bot protection is unavailable. Please try again later.</p>;
  return (
    <>
      <Script
        onError={() => setStatus('error')}
        onReady={() => setProviderReady(true)}
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div aria-label="Bot protection challenge" ref={container} />
      {token ? <input name="cf-turnstile-response" type="hidden" value={token} /> : null}
      {status === 'loading' ? (
        <p aria-live="polite" role="status">
          Bot protection is loading…
        </p>
      ) : status === 'ready' ? (
        <p className="sr-only" role="status">
          Bot protection is complete.
        </p>
      ) : (
        <div className="grid gap-2">
          <p role="alert">Bot protection could not load. Retry the challenge.</p>
          <button className="min-h-11 rounded border px-3" onClick={retry} type="button">
            Retry bot protection
          </button>
        </div>
      )}
    </>
  );
}
