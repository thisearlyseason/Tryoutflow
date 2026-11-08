import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout engine; tests that exercise responsive transitions replace
// this default with their own query state and dispatch change events explicitly.
if (typeof window !== 'undefined')
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const events = new EventTarget();
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: (listener) => events.addEventListener('change', listener as EventListener),
        removeListener: (listener) =>
          events.removeEventListener('change', listener as EventListener),
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
      };
    },
  });

// jsdom does not implement the dialog top layer. Browser tests verify native
// modal focus trapping; component tests need its open/close state transitions.
if (
  typeof HTMLDialogElement !== 'undefined' &&
  typeof HTMLDialogElement.prototype.showModal !== 'function'
) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

process.env.NEXT_PUBLIC_EVALUATION_SNAPSHOT_PROOF_PUBLIC_JWK =
  '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256"}';
process.env.EVALUATION_SNAPSHOT_PROOF_PRIVATE_JWK =
  '{"kty":"EC","x":"_dPSSLsCXidd4IPFKgJiSwnJ5UBPRpQGKTLfFAN0zG8","y":"DgpgvwNVaOr-dWfrync-k3yGYDk8OGjuElujacdtynQ","crv":"P-256","d":"vDD7kT3X7_b_h5H_sUMNhi8gXMJeZ4MmSQZxJDTmjg0"}';
process.env.NEXT_PUBLIC_APP_URL = 'https://tryoutflow.test';
process.env.TRYOUTFLOW_SERVER_TEST_ENV = 'vitest';
process.env.TRYOUTFLOW_BOT_PROTECTION_MODE = 'deterministic-test';
process.env.ABUSE_PROTECTION_HMAC_SECRET = 'unit-test-abuse-protection-secret'.padEnd(64, 'x');

const settleDOMTimers = globalThis.setTimeout;

afterEach(async () => {
  cleanup();
  // Radix restores focus on the next task after unmount. Let that run while
  // this jsdom realm still owns CustomEvent, before Vitest tears it down.
  if (typeof window !== 'undefined') {
    await new Promise<void>((resolve) => settleDOMTimers(resolve, 0));
  }
});
