const task30PublicOrigin = 'https://task30.e2e.example.test';
const task30LocalOrigin = 'http://127.0.0.1:3112';

/** Keep the production-route fake provider unreachable outside the exact Task 30 server harness. */
export function task30FakeBillingProviderOrigin(
  environment: Record<string, string | undefined>,
): string | null {
  return environment.TRYOUTFLOW_SERVER_TEST_ENV === 'task30-playwright' &&
    environment.TRYOUTFLOW_FAKE_BILLING_PROVIDER === 'true' &&
    environment.NEXT_PUBLIC_APP_URL === task30PublicOrigin &&
    environment.TASK30_LOCAL_REQUEST_ORIGIN === task30LocalOrigin
    ? task30LocalOrigin
    : null;
}
