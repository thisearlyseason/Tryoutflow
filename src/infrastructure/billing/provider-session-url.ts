export type BillingSessionKind = 'checkout' | 'portal';

const checkoutSessionId = 'cs_(?:test|live)_[A-Za-z0-9]{8,200}';
const portalSessionId = 'bps_[A-Za-z0-9]{8,200}';
const checkoutUrl = new RegExp(
  `^https://checkout[.]stripe[.]com/c/pay/(${checkoutSessionId})(?:#([A-Za-z0-9_-]{1,2048}))?$`,
  'u',
);
const portalUrl = new RegExp(
  `^https://billing[.]stripe[.]com/p/session/(${portalSessionId})$`,
  'u',
);

/**
 * Stripe checkout currently appends an opaque client fragment to some hosted checkout URLs. We
 * retain only its bounded, unencoded opaque alphabet. Portal URLs do not permit a fragment.
 */
export function isValidBillingSessionUrl(
  sessionId: string,
  url: string,
  kind: BillingSessionKind,
): boolean {
  const match = (kind === 'checkout' ? checkoutUrl : portalUrl).exec(url);
  return match?.[0] === url && match[1] === sessionId;
}
