import 'server-only';
import { createAdminSupabaseClient } from '@/infrastructure/supabase/admin';
export async function withBillingDelivery(
  event: { provider: 'stripe' | 'revenuecat'; id: string; type: string; digest: string },
  process: () => Promise<Response>,
) {
  const client = createAdminSupabaseClient();
  const parameters = {
    p_provider: event.provider,
    p_id: event.id,
    p_type: event.type,
    p_digest: event.digest,
  };
  try {
    const { data, error } = await client.rpc('record_billing_delivery', parameters);
    if (error) throw error;
    if (data === 'processed') return Response.json({ outcome: 'replayed' });
    if (data !== 'process')
      return Response.json({ error: 'Delivery cannot be processed yet.' }, { status: 409 });
    let result: Response;
    try {
      result = await process();
    } catch {
      result = Response.json(
        { error: 'Billing confirmation is temporarily unavailable.' },
        { status: 503 },
      );
    }
    const finished = await client.rpc('record_billing_delivery', {
      ...parameters,
      p_success: result.ok,
    });
    if (finished.error) throw finished.error;
    return result;
  } catch {
    return Response.json(
      { error: 'Billing confirmation is temporarily unavailable.' },
      { status: 503 },
    );
  }
}
