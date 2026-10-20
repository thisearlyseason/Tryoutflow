'use client';
import { useEffect } from 'react';
export function FixtureBridge() {
  useEffect(() => {
    const send = () => {
      const w = window as unknown as {
        __tryoutflowNonce?: string;
        ReactNativeWebView?: { postMessage: (s: string) => void };
      };
      if (!w.__tryoutflowNonce || !w.ReactNativeWebView) return;
      const userId = '99999999-9999-4999-8999-999999999901';
      const expiresAt = Math.floor(Date.now() / 1000) + 1800;
      const token =
        'synthetic.' +
        btoa(JSON.stringify({ sub: userId, exp: expiresAt }))
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_') +
        '.invalid_signature';
      w.ReactNativeWebView.postMessage(
        JSON.stringify({
          type: 'session',
          nonce: w.__tryoutflowNonce,
          session: { userId, accessToken: token, expiresAt },
        }),
      );
    };
    send();
    window.addEventListener('tryoutflow-native-ready', send);
    return () => window.removeEventListener('tryoutflow-native-ready', send);
  }, []);
  return (
    <p
      style={{
        position: 'fixed',
        bottom: 0,
        zIndex: 80,
        background: '#fff3a3',
        color: '#111',
        padding: 6,
        fontSize: 12,
      }}
    >
      LOCAL SYNTHETIC AUTH/API — NOT ACCOUNT, PAYMENT OR STORE EVIDENCE
    </p>
  );
}
