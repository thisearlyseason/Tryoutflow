import 'server-only';

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
    /^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/u.test(
      environment.NEXT_PUBLIC_SUPABASE_URL ?? '',
    )
  );
}
