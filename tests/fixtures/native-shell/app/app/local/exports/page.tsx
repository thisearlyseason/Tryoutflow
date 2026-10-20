'use client';
import { useState } from 'react';
export default function Exports() {
  const [status, setStatus] = useState('No export started.');
  function share() {
    const w = window as unknown as {
      __tryoutflowNonce?: string;
      ReactNativeWebView?: { postMessage: (s: string) => void };
    };
    if (!w.ReactNativeWebView || !w.__tryoutflowNonce) {
      setStatus('Native shell is required for this synthetic share-sheet check.');
      return;
    }
    setStatus('Requested native share sheet; completion is not yet verified.');
    w.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: 'report',
        nonce: w.__tryoutflowNonce,
        userId: '99999999-9999-4999-8999-999999999901',
        requestId: crypto.randomUUID(),
        mime: 'text/csv',
        data: btoa('Athlete number,Preferred name,Score\r\n42,Synthetic Athlete,80\r\n'),
      }),
    );
  }
  return (
    <main className="p-4">
      <h1>Synthetic export check</h1>
      <p>No real athlete data. Open the share sheet, then cancel; do not send to anyone.</p>
      <button className="min-h-11 rounded border p-3" onClick={share}>
        Prepare synthetic CSV share sheet
      </button>
      <p role="status">{status}</p>
    </main>
  );
}
