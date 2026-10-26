import 'server-only';

import { isBrowserTestBackend } from '../../../lib/browser-test-backend';

/** Deliberate browser-test fault injection; every production configuration predicate is exact. */
export function shouldInjectTestLoaderFailure(
  requestedBoundary: string | undefined,
  routeBoundary: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return (
    requestedBoundary === routeBoundary &&
    environment.NODE_ENV === 'production' &&
    environment.TRYOUTFLOW_SERVER_TEST_ENV === 'task30-playwright' &&
    environment.NEXT_PUBLIC_APP_URL === 'https://task30.e2e.example.test' &&
    isBrowserTestBackend(environment)
  );
}
