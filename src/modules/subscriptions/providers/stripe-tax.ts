import type Stripe from 'stripe';

type TaxState = { enabled: boolean; status?: string | null; disabled_reason?: string | null };
/** A completed calculation may legitimately be zero. We do not infer exemptions. */
export function taxCalculationComplete(tax: TaxState | null | undefined, required = false) {
  if (!tax?.enabled) return !required && !tax?.disabled_reason;
  return tax.status === 'complete' && !tax.disabled_reason;
}

export function subscriptionTaxSettings(sub: Stripe.Subscription) {
  const tax = sub.automatic_tax;
  const managedRequired = sub.metadata.tax_protocol === 'managed_v1';
  const managed = sub.managed_payments?.enabled === true;
  if (managedRequired && !managed) throw new Error('managed_payments_not_verified');
  if (tax.disabled_reason || (tax.liability && tax.liability.type !== 'self' && !managed))
    throw new Error('unsupported_subscription_tax');
  if ((sub.metadata.tax_protocol === 'standard_tax_v1' || managedRequired) && !tax.enabled)
    throw new Error('subscription_tax_disabled');
  if (managed && tax.enabled) {
    if (!tax.liability) throw new Error('managed_tax_liability_not_verified');
    const liability =
      tax.liability.type === 'account'
        ? {
            type: 'account' as const,
            account:
              typeof tax.liability.account === 'string'
                ? tax.liability.account
                : tax.liability.account?.id,
          }
        : { type: 'self' as const };
    if (liability.type === 'account' && !liability.account)
      throw new Error('managed_tax_liability_not_verified');
    return { enabled: true, liability };
  }
  return tax.enabled ? { enabled: true, liability: { type: 'self' as const } } : { enabled: false };
}
