import 'server-only';
import { createAdminSupabaseClient } from '@/infrastructure/supabase/admin';
import { reconcileOrganizationSubscription } from './billing-service';
/** One leased organization per existing jobs invocation bounds provider work and supports retries. */
export async function runBillingReconciliationJob() {
  if (!process.env.BILLING_ENVIRONMENT) return;
  const client = createAdminSupabaseClient();
  const { data: organizationId, error } = await client.rpc('claim_billing_reconciliation');
  if (error) throw new Error('billing_queue_unavailable');
  if (!organizationId) return;
  let success = false;
  try {
    await reconcileOrganizationSubscription(organizationId);
    success = true;
  } finally {
    await client.rpc('finish_billing_reconciliation', {
      p_organization_id: organizationId,
      p_success: success,
    });
  }
}
