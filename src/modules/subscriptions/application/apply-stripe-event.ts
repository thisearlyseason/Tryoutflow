import { z } from 'zod';

import type { StripePriceMapping } from '../domain/plans';
import { planForStripePrice } from '../domain/plans';

const providerId = z.string().regex(/^(?:evt|cus|sub|price)_[A-Za-z0-9_]{8,200}$/u);
const stripeSubscriptionEventSchema = z
  .object({
    id: providerId,
    object: z.literal('event'),
    created: z.number().int().nonnegative(),
    type: z.enum([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]),
    data: z
      .object({
        object: z
          .object({
            id: providerId,
            object: z.literal('subscription'),
            customer: z.union([providerId, z.object({ id: providerId }).passthrough()]),
            status: z.string().min(1).max(100),
            metadata: z.record(z.string(), z.string()).default({}),
            items: z
              .object({
                data: z
                  .array(
                    z.object({ price: z.object({ id: providerId }).passthrough() }).passthrough(),
                  )
                  .max(100),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const applicationOutcomeSchema = z.enum([
  'applied',
  'replayed',
  'ignored_out_of_order',
  'unknown_price',
  'unbound',
  'customer_conflict',
  'subscription_conflict',
  'invalid_state',
  'event_conflict',
]);
export type StripeEventApplicationOutcome = z.infer<typeof applicationOutcomeSchema>;

export type SubscriptionEventRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function normalizedState(type: string, status: string) {
  if (type === 'customer.subscription.deleted') return 'canceled';
  if (
    status === 'trialing' ||
    status === 'active' ||
    status === 'past_due' ||
    status === 'canceled'
  )
    return status;
  return null;
}

export function parseStripeSubscriptionEvent(input: unknown, prices: StripePriceMapping) {
  const event = stripeSubscriptionEventSchema.parse(input);
  const subscription = event.data.object;
  const uniquePrices = [...new Set(subscription.items.data.map((item) => item.price.id))];
  const priceId = uniquePrices.length === 1 ? uniquePrices[0]! : '';
  const organization = z.uuid().safeParse(subscription.metadata.organization_id);
  const organizationId = organization.success ? organization.data : null;
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  return {
    eventId: event.id,
    eventType: event.type,
    providerCreatedAt: new Date(event.created * 1_000).toISOString(),
    customerId,
    subscriptionId: subscription.id,
    organizationId,
    plan: priceId ? planForStripePrice(priceId, prices) : null,
    state: normalizedState(event.type, subscription.status),
    // Keep only allow-listed diagnostic evidence. The digest still binds the exact verified raw
    // delivery without copying arbitrary provider metadata into our database.
    payload: {
      eventId: event.id,
      eventType: event.type,
      providerCreatedAt: event.created,
      customerId,
      subscriptionId: subscription.id,
      organizationId,
      priceIds: uniquePrices,
      providerState: subscription.status,
    },
  } as const;
}

export async function applyStripeEvent(
  input: ReturnType<typeof parseStripeSubscriptionEvent> & { payloadDigest: string },
  client: SubscriptionEventRpcClient,
): Promise<StripeEventApplicationOutcome> {
  const { data, error } = await client.rpc('apply_stripe_subscription_event', {
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_provider_created_at: input.providerCreatedAt,
    p_customer_id: input.customerId,
    p_subscription_id: input.subscriptionId,
    p_organization_id: input.organizationId,
    p_plan_key: input.plan,
    p_state: input.state,
    p_payload: input.payload,
    p_payload_digest: input.payloadDigest,
  });
  if (error) throw new Error('subscription_event_application_failed');
  return applicationOutcomeSchema.parse(data);
}
