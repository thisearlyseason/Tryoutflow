'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
export function NativeBillingEntry({ slug }: { slug: string }) {
  function open() {
    const surface = window as Window & {
      ReactNativeWebView?: { postMessage: (value: string) => void };
      __tryoutflowNonce?: string;
      __tryoutflowUserId?: string;
    };
    if (!surface.ReactNativeWebView || !surface.__tryoutflowNonce || !surface.__tryoutflowUserId)
      return;
    surface.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: 'billing',
        nonce: surface.__tryoutflowNonce,
        userId: surface.__tryoutflowUserId,
        slug,
      }),
    );
  }
  useEffect(() => {
    open();
    window.addEventListener('tryoutflow-session-ready', open);
    return () => window.removeEventListener('tryoutflow-session-ready', open);
  }, [slug]);
  return <Button onClick={open}>Open device billing & access</Button>;
}
