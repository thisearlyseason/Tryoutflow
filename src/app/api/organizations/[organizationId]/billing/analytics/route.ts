import { z } from 'zod';
import { billingRequestContext } from '@/modules/subscriptions/application/billing-request';
import { readBoundedStripeBody } from '@/app/api/webhooks/stripe/stripe-webhook';
const schema = z.object({
  id: z.uuid(),
  event: z.enum([
    'pricing_viewed',
    'checkout_started',
    'checkout_completed',
    'checkout_cancelled',
    'plan_upgraded',
    'plan_downgrade_requested',
    'subscription_cancelled',
    'subscription_restored',
    'upgrade_prompt_viewed',
    'feature_limit_reached',
  ]),
});
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const { organizationId } = await params;
    z.uuid().parse(organizationId);
    const { client } = await billingRequestContext(request);
    const input = schema.parse(
      JSON.parse(Buffer.from(await readBoundedStripeBody(request, 1024)).toString('utf8')),
    );
    const { error } = await client.rpc('record_billing_analytics', {
      p_id: input.id,
      p_organization_id: organizationId,
      p_event: input.event,
    });
    if (error) throw error;
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
