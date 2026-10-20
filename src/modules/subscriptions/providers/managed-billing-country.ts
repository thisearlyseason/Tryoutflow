// A declaration is defense in depth, not proof of payment-time/renewal country.
// Never use shipping address or override Managed payment-method controls.
export function managedBillingCountryAllowed(
  declaration: unknown,
  environment: Record<string, string | undefined> = process.env,
): declaration is 'CA' | 'US' {
  if (declaration !== 'CA' && declaration !== 'US') return false;
  let isolatedFixture = false;
  try {
    const url = new URL(environment.NEXT_PUBLIC_APP_URL ?? '');
    isolatedFixture =
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      url.port === '3138' &&
      environment.BILLING_ENVIRONMENT === 'sandbox' &&
      environment.STRIPE_MANAGED_EXPECTED_TEST_ACCOUNT === 'acct_1UBERCKFGD4sbm5r';
  } catch {
    /* missing configuration is handled by the independent activation gate */
  }
  return !isolatedFixture || declaration === environment.STRIPE_MANAGED_TEST_FIXTURE_COUNTRY;
}
