// Verified Stripe tax-compliance list, 2026-10-02. Processing eligibility is
// broader than coverage. Do not infer coverage merely from managed.enabled.
const supportedSellers = new Set(
  'CA US AT BE BG CH CY CZ DE DK EE ES FI FR GB GR HR HU IE IT LI LT LU LV MT NL NO PL PT RO SE SI SK AU HK JP SG'.split(
    ' ',
  ),
);
const crossBorder = new Set(
  `CM EG GH KE NG UG ZA ZM ZW AM AU AZ BN GE HK ID IL IN JP KG KR KW KZ LA MO MY NP NZ PH QA SA SG TH TJ TR TW VN AL BY CH GB GI IS LI MD NO RS UA AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK BB BM KY MX VG CA US`.split(
    ' ',
  ),
);
export function documentedManagedCoverage(input: {
  sellerCountry?: string | null;
  buyerCountry?: string | null;
  sellerEligible: boolean;
  businessPurchase?: boolean;
  sellerRegisteredInSerbia?: boolean;
}) {
  const { sellerCountry: seller, buyerCountry: buyer } = input;
  if (
    !input.sellerEligible ||
    !seller ||
    !supportedSellers.has(seller) ||
    !buyer ||
    !/^[A-Z]{2}$/.test(seller) ||
    !/^[A-Z]{2}$/.test(buyer)
  )
    return false;
  if (seller === buyer) {
    if (seller === 'JP') return false;
    if (seller === 'SG') return input.businessPurchase === false;
    return true;
  }
  if (buyer === 'RS' && input.sellerRegisteredInSerbia !== false) return false;
  return crossBorder.has(buyer);
}
// Narrow initial policy matches the requested Canada/US launch. Account country
// must be separately verified; arbitrary seller-location inputs are not trusted.
export function launchManagedCoverage(
  seller: string | null | undefined,
  buyer: string | null | undefined,
) {
  return (
    seller === 'CA' &&
    (buyer === 'CA' || buyer === 'US') &&
    documentedManagedCoverage({ sellerCountry: seller, buyerCountry: buyer, sellerEligible: true })
  );
}
export function managedPrePaymentEnforcementAvailable(
  env: Record<string, string | undefined> = process.env,
) {
  // Isolated, zero-charge acceptance only; this never attests provider country
  // enforcement. The private runner independently verifies the exact test account.
  // No caller/request field can select this branch; production remains fail closed.
  let local = false;
  try {
    const u = new URL(env.NEXT_PUBLIC_APP_URL ?? '');
    local =
      u.protocol === 'http:' &&
      ['127.0.0.1', 'localhost'].includes(u.hostname) &&
      u.port === '3138';
  } catch {
    /* fail closed */
  }
  if (
    local &&
    env.BILLING_ENVIRONMENT === 'sandbox' &&
    env.STRIPE_MANAGED_EXPECTED_TEST_ACCOUNT === 'acct_1UBERCKFGD4sbm5r' &&
    ['CA', 'US'].includes(env.STRIPE_MANAGED_TEST_FIXTURE_COUNTRY ?? '') &&
    /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? '')
  )
    return true;
  // Canada/US is the initial offer, not a universal geographical guarantee.
  // Managed chooses its current default methods; no NoLocalMethods attestation is made.
  // These server-only settings cannot be enabled by buyer form inputs.
  return env.STRIPE_MANAGED_SELLER_COUNTRY === 'CA';
}
