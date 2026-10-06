import { nativeContext } from '@/modules/identity/native-context';
import { z } from 'zod';
import { ownerBillingContext } from '@/modules/subscriptions/application/billing-request';
import {
  providerContext,
  reconcileOrganizationSubscription,
} from '@/modules/subscriptions/application/billing-service';
import { stripeBillingClient } from '@/modules/subscriptions/providers/stripe';
import {
  PlanChangeConflict,
  previewStripePlanChange,
  scheduleStripePlanChange,
  cancelStripePlanChange,
} from '@/modules/subscriptions/providers/stripe-plan-change';
import { readBoundedStripeBody } from '@/app/api/webhooks/stripe/stripe-webhook';

const product = z.enum([
  'pro_monthly',
  'pro_annual',
  'organization_monthly',
  'organization_annual',
]);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), product }),
  z.object({
    action: z.literal('confirm'),
    product,
    token: z.string().regex(/^[a-f0-9]{64}$/),
    attemptId: z.uuid(),
  }),
  z.object({ action: z.literal('cancel'), product, effectiveAt: z.iso.datetime({ offset: true }) }),
]);
export const runtime = 'nodejs';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  if (nativeContext(request.headers.get('cookie')))
    return Response.json({ error: 'Use your device store controls.' }, { status: 403 });
  try {
    const { organizationId } = await params;
    z.uuid().parse(organizationId);
    const { client, isNative } = await ownerBillingContext(request, organizationId);
    if (isNative)
      return Response.json(
        { error: 'Manage web subscriptions from your web account.' },
        { status: 403 },
      );
    const input = schema.parse(
      JSON.parse(Buffer.from(await readBoundedStripeBody(request, 4096)).toString('utf8')),
    );
    const context = await providerContext(organizationId);
    const contracts = context.contracts.filter(
      (c) =>
        !c.tryout_id &&
        c.status === 'active' &&
        c.current_period_end &&
        Date.parse(c.current_period_end) > Date.now(),
    );
    if (contracts.length !== 1 || contracts[0]!.provider !== 'stripe')
      throw new PlanChangeConflict(
        'Refresh your subscription. Only an active web subscription can be changed here.',
      );
    const account = contracts[0]!;
    const stripe = stripeBillingClient();
    if (input.action === 'preview') {
      const { quote } = await previewStripePlanChange(stripe, account, input.product);
      return Response.json({ quote }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (input.action === 'confirm')
      await scheduleStripePlanChange(stripe, account, input.product, input.token, input.attemptId);
    else await cancelStripePlanChange(stripe, account, input.product, input.effectiveAt);
    await reconcileOrganizationSubscription(organizationId);
    const { data, error } = await client.rpc('get_billing_dashboard', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    return Response.json(
      {
        dashboard: data,
        message:
          input.action === 'confirm'
            ? 'Plan change scheduled for your next renewal. Your current access continues until then.'
            : 'Pending plan change cancelled. Your current subscription continues.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PlanChangeConflict
            ? error.message
            : 'Unable to change this subscription. Refresh its status before trying again.',
      },
      { status: error instanceof PlanChangeConflict ? 409 : 503 },
    );
  }
}
