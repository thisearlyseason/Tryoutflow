export type BillingSessionKind = 'checkout' | 'portal';

/**
 * Conservative storage and parser limits for Stripe-hosted billing capabilities. Stripe does not
 * publish stable maximum lengths for these opaque values, so the object-ID caps preserve the
 * application's existing 200-character provider suffix contract, while bearer/fragment values
 * receive a larger 2 KiB allowance inside the existing 4 KiB URL envelope. All accepted
 * characters are ASCII, making JavaScript string length equivalent to PostgreSQL char/octet caps.
 */
export const BILLING_SESSION_LIMITS = Object.freeze({
  checkoutFragmentLength: 2_048,
  checkoutSessionIdSuffixLength: 200,
  maximumUrlLength: 4_096,
  portalBearerTokenSuffixLength: 2_048,
  portalSessionIdSuffixLength: 200,
});

const checkoutSessionId = `cs_(?:test|live)_[A-Za-z0-9]{1,${BILLING_SESSION_LIMITS.checkoutSessionIdSuffixLength}}`;
const portalSessionId = `bps_[A-Za-z0-9]{1,${BILLING_SESSION_LIMITS.portalSessionIdSuffixLength}}`;
const fragmentCharacter = "(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[A-Fa-f0-9]{2})";
const checkoutUrl = new RegExp(
  `^https://checkout[.]stripe[.]com/c/pay/(${checkoutSessionId})(?:#(${fragmentCharacter}+))?$`,
  'u',
);
const portalUrl = new RegExp(
  `^https://billing[.]stripe[.]com/p/session/(?:test|live)_[A-Za-z0-9]{1,${BILLING_SESSION_LIMITS.portalBearerTokenSuffixLength}}$`,
  'u',
);
const checkoutId = new RegExp(`^${checkoutSessionId}$`, 'u');
const portalId = new RegExp(`^${portalSessionId}$`, 'u');

export function isValidBillingSessionId(sessionId: string, kind: BillingSessionKind): boolean {
  return (kind === 'checkout' ? checkoutId : portalId).test(sessionId);
}

/**
 * Stripe checkout currently appends an opaque client fragment to some hosted checkout URLs. We
 * retain only a bounded RFC 3986 fragment alphabet with well-formed percent escapes. Portal
 * object IDs are independent from their short-lived URL bearer tokens.
 */
export function isValidBillingSessionUrl(
  sessionId: string,
  url: string,
  kind: BillingSessionKind,
): boolean {
  if (url.length > BILLING_SESSION_LIMITS.maximumUrlLength) return false;
  if (!isValidBillingSessionId(sessionId, kind)) return false;
  if (kind === 'portal') return portalUrl.test(url);
  const match = checkoutUrl.exec(url);
  return (
    match?.[0] === url &&
    match[1] === sessionId &&
    (match[2] === undefined || match[2].length <= BILLING_SESSION_LIMITS.checkoutFragmentLength)
  );
}
