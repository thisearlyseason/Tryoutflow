'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/infrastructure/supabase/client';
type NativeWindow = Window & {
  ReactNativeWebView?: { postMessage: (message: string) => void };
  __tryoutflowNonce?: string;
  __tryoutflowUserId?: string;
};
export function NativeWorkspaceBridge() {
  const pathname = usePathname();
  useEffect(() => {
    const surface = window as NativeWindow;
    if (surface.ReactNativeWebView && surface.__tryoutflowNonce)
      surface.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'navigation', nonce: surface.__tryoutflowNonce, pathname }),
      );
  }, [pathname]);
  useEffect(() => {
    let disconnect: (() => void) | undefined;
    function connect() {
      const surface = window as NativeWindow;
      const nonce = surface.__tryoutflowNonce;
      if (!surface.ReactNativeWebView || !nonce) return;
      const client = createBrowserSupabaseClient();
      const send = (
        session: { access_token: string; expires_at?: number; user: { id: string } } | null,
      ) => {
        surface.__tryoutflowUserId = session?.user.id;
        surface.ReactNativeWebView?.postMessage(
          JSON.stringify({
            type: 'session',
            nonce,
            session: session
              ? {
                  accessToken: session.access_token,
                  expiresAt: session.expires_at,
                  userId: session.user.id,
                }
              : null,
          }),
        );
        window.dispatchEvent(new Event('tryoutflow-session-ready'));
      };
      let active = true;
      let authChanged = false;
      const pending = new WeakSet<HTMLAnchorElement>();
      const requests = new Map<string, HTMLAnchorElement>();
      const notice = document.createElement('p');
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.className = 'native-download-status';
      document.body.appendChild(notice);
      const result = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.nonce !== nonce || typeof detail.message !== 'string') return;
        const link = requests.get(detail.requestId);
        if (!link) return;
        pending.delete(link);
        link.removeAttribute('aria-busy');
        requests.delete(detail.requestId);
        notice.textContent = detail.message;
      };
      window.addEventListener('tryoutflow-file-result', result);
      const download = async (event: MouseEvent) => {
        const link = (event.target as Element)?.closest<HTMLAnchorElement>('a[href]');
        if (!link) return;
        const url = new URL(link.href);
        const localBlob =
          url.protocol === 'blob:' && url.origin === location.origin && !!link.download;
        if (
          !localBlob &&
          (url.origin !== location.origin ||
            !/^(\/app\/[^/]+\/reports\/(scouting\/export|exports\/[a-f0-9-]{36})|\/api\/organizations\/[a-f0-9-]{36}\/exports\/(athletes|evaluations|roster))$/.test(
              url.pathname,
            ))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (pending.has(link)) return;
        const userId = surface.__tryoutflowUserId;
        pending.add(link);
        link.setAttribute('aria-busy', 'true');
        notice.textContent = 'Preparing report…';
        let delegated = false;
        try {
          const response = await fetch(url.href, {
            credentials: 'same-origin',
            signal: AbortSignal.timeout(20000),
          });
          const mime = response.headers.get('content-type')?.split(';')[0];
          if (!response.ok || (mime !== 'text/csv' && !(localBlob && mime === 'application/json')))
            throw new Error();
          const blob = await response.blob();
          if (blob.size > 5 * 1024 * 1024) {
            notice.textContent =
              'This report exceeds the app’s 5 MB share limit. Narrow the report and retry.';
            return;
          }
          const encoded = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
            reader.readAsDataURL(blob);
          });
          if (!active || !userId || surface.__tryoutflowUserId !== userId) throw new Error();
          const requestId = crypto.randomUUID();
          requests.set(requestId, link);
          delegated = true;
          surface.ReactNativeWebView?.postMessage(
            JSON.stringify({
              type: 'report',
              userId,
              mime,
              nonce,
              requestId,
              data: encoded,
            }),
          );
          notice.textContent = 'Opening report share sheet…';
        } catch {
          notice.textContent =
            'Report could not be prepared. Check your connection and access, then retry.';
        } finally {
          if (!delegated) {
            pending.delete(link);
            link.removeAttribute('aria-busy');
          }
        }
      };
      document.addEventListener('click', download, true);
      client.auth.getSession().then(({ data }) => {
        if (active && !authChanged) send(data.session);
      });
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, session) => {
        authChanged = true;
        send(session);
      });
      return () => {
        active = false;
        subscription.unsubscribe();
        document.removeEventListener('click', download, true);
        window.removeEventListener('tryoutflow-file-result', result);
        notice.remove();
      };
    }
    function ready() {
      if (!disconnect) disconnect = connect();
    }
    window.addEventListener('tryoutflow-native-ready', ready);
    ready();
    return () => {
      window.removeEventListener('tryoutflow-native-ready', ready);
      disconnect?.();
    };
  }, []);
  return null;
}
