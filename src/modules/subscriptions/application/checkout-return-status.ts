import type { providerContext } from './billing-service';
import { isBillingProduct } from '../domain/billing-products';
import type { z } from 'zod';
import type { checkoutReturnSchema } from '../domain/billing-dashboard';

// The caller has already authorized the owner and loaded the current-environment ledger.
// This derives a display status only; it never reconciles, purchases or grants access.
export function checkoutReturnStatus(
  context: Pick<Awaited<ReturnType<typeof providerContext>>, 'intents' | 'contracts'>,
  input: { organizationId: string; purchaserId: string; intentId: string; now: Date },
): z.infer<typeof checkoutReturnSchema> {
  const result = (status: z.infer<typeof checkoutReturnSchema>['status']) => ({
    intentId: input.intentId,
    status,
  });
  const at = input.now.getTime();
  if (!Number.isFinite(at)) return result('unavailable');
  const intents = context.intents.filter(
    (intent) =>
      intent.id === input.intentId &&
      intent.organization_id === input.organizationId &&
      intent.purchaser_id === input.purchaserId &&
      intent.provider === 'stripe',
  );
  if (intents.length !== 1) return result('unavailable');
  const intent = intents[0]!;
  if (
    !isBillingProduct(intent.product_key) ||
    (intent.product_key === 'single_tryout_pro' ? !intent.tryout_id : intent.tryout_id !== null)
  )
    return result('unavailable');
  if (!intent.contract_id) {
    const end = Date.parse(intent.expires_at);
    return result(!Number.isFinite(end) ? 'unavailable' : end <= at ? 'expired' : 'pending');
  }
  const contracts = context.contracts.filter(
    (contract) =>
      contract.id === intent.contract_id &&
      contract.organization_id === input.organizationId &&
      contract.purchaser_id === input.purchaserId &&
      contract.provider === intent.provider &&
      contract.product_key === intent.product_key &&
      contract.tryout_id === intent.tryout_id,
  );
  if (contracts.length !== 1) return result('unavailable');
  const contract = contracts[0]!;
  if (
    !['active', 'trialing', 'grace_period', 'past_due', 'cancelled'].includes(contract.status) ||
    !Number.isFinite(Date.parse(contract.current_period_start)) ||
    Date.parse(contract.current_period_start) > at
  )
    return result('unavailable');
  if (intent.product_key === 'single_tryout_pro' && contract.current_period_end === null)
    return result('confirmed');
  const end = Date.parse(contract.current_period_end ?? '');
  const grace = ['past_due', 'grace_period'].includes(contract.status)
    ? Date.parse(contract.grace_period_end ?? '')
    : NaN;
  return result(
    (Number.isFinite(end) && end > at) || (Number.isFinite(grace) && grace > at)
      ? 'confirmed'
      : 'unavailable',
  );
}
