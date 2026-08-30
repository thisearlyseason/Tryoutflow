export type BillingSessionKind = 'checkout' | 'portal';

const checkoutSessionId = 'cs_(?:test|live)_[A-Za-z0-9]+';
const portalSessionId = 'bps_[A-Za-z0-9]+';
const fragmentCharacter = "(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[A-Fa-f0-9]{2})";
const checkoutUrl = new RegExp(
  `^https://checkout[.]stripe[.]com/c/pay/(${checkoutSessionId})(?:#(${fragmentCharacter}+))?$`,
  'u',
);
const portalUrl = /^https:\/\/billing[.]stripe[.]com\/p\/session\/(?:test|live)_[A-Za-z0-9]+$/u;
const checkoutId = new RegExp(`^${checkoutSessionId}$`, 'u');
const portalId = new RegExp(`^${portalSessionId}$`, 'u');

const maximumCheckoutFragmentLength = 2_048;

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
  if (!isValidBillingSessionId(sessionId, kind)) return false;
  if (kind === 'portal') return portalUrl.test(url);
  const match = checkoutUrl.exec(url);
  return (
    match?.[0] === url &&
    match[1] === sessionId &&
    (match[2] === undefined || match[2].length <= maximumCheckoutFragmentLength)
  );
}
