'use client';

export default function PlatformError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section aria-labelledby="platform-error-title" className="mx-auto max-w-2xl p-6">
      <h1 id="platform-error-title">Platform tools are temporarily unavailable</h1>
      <p className="mt-2">
        No operational details were exposed. Retry, then follow the incident runbook if the problem
        continues.
      </p>
      <button className="mt-4" onClick={reset} type="button">
        Retry platform tools
      </button>
    </section>
  );
}
