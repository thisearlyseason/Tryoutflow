'use client';

import Script from 'next/script';

import type { BotAction } from '../application/bot-protection';

export function TurnstileClientChallenge({
  action,
  deterministicToken,
  siteKey,
}: {
  action: BotAction;
  deterministicToken?: string;
  siteKey?: string;
}) {
  if (deterministicToken)
    return <input name="cf-turnstile-response" type="hidden" value={deterministicToken} />;
  if (!siteKey) return <p role="alert">Bot protection is unavailable. Please try again later.</p>;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <div className="cf-turnstile" data-action={action} data-sitekey={siteKey} />
    </>
  );
}
