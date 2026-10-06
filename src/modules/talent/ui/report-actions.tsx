'use client';
import { useEffect, useRef, useState } from 'react';
import { FeedbackButton } from '@/components/ui/button';
export function PrintReport({
  label = 'Print / save PDF',
  className = 'button-secondary talent-no-print',
}: { label?: string; className?: string } = {}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef('');
  useEffect(() => {
    function result(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.nonce === (window as Window & { __tryoutflowNonce?: string }).__tryoutflowNonce &&
        detail?.requestId === request.current &&
        typeof detail.message === 'string'
      ) {
        setBusy(false);
        setMessage(detail.message);
      }
    }
    window.addEventListener('tryoutflow-file-result', result);
    return () => window.removeEventListener('tryoutflow-file-result', result);
  }, []);
  return (
    <>
      <FeedbackButton
        busy={busy}
        className={className}
        onClick={() => {
          const surface = window as Window & {
            ReactNativeWebView?: { postMessage: (value: string) => void };
            __tryoutflowNonce?: string;
            __tryoutflowUserId?: string;
          };
          if (!surface.ReactNativeWebView || !surface.__tryoutflowNonce) {
            window.print();
            return;
          }
          if (!surface.__tryoutflowUserId) {
            setMessage('Sign in before preparing this report.');
            return;
          }
          const report = document.documentElement.cloneNode(true) as HTMLElement;
          report
            .querySelectorAll('script, iframe, form, input, button, .talent-no-print')
            .forEach((element) => element.remove());
          report.querySelectorAll('img').forEach((image) => {
            if (!image.src.startsWith(location.origin)) image.remove();
          });
          const base = document.createElement('base');
          base.href = location.origin + '/';
          report.querySelector('head')?.prepend(base);
          const html = '<!doctype html>' + report.outerHTML;
          if (html.length > 5 * 1024 * 1024) {
            setMessage('This report is too large for an in-app PDF. Narrow the report and retry.');
            return;
          }
          request.current = crypto.randomUUID();
          setBusy(true);
          setMessage('Preparing PDF…');
          surface.ReactNativeWebView.postMessage(
            JSON.stringify({
              type: 'print',
              userId: surface.__tryoutflowUserId,
              nonce: surface.__tryoutflowNonce,
              requestId: request.current,
              html,
            }),
          );
        }}
      >
        Print / save PDF
      </FeedbackButton>
      {message ? (
        <p role="status" className="talent-no-print">
          {message}
        </p>
      ) : null}
    </>
  );
}
