import { z } from 'zod';

import {
  stripeCustomerIdSchema,
  stripeEventIdSchema,
  stripePriceIdSchema,
  stripeSubscriptionIdSchema,
} from '../../../infrastructure/billing/billing-provider';
import type { StripePriceMapping } from '../domain/plans';
import { planForStripePrice } from '../domain/plans';

const stripeUnixSecondsSchema = z.number().int().min(0).max(253_402_300_799);
const stripeSubscriptionEventSchema = z
  .object({
    id: stripeEventIdSchema,
    object: z.literal('event'),
    created: stripeUnixSecondsSchema,
    type: z.enum([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]),
    data: z
      .object({
        object: z
          .object({
            id: stripeSubscriptionIdSchema,
            object: z.literal('subscription'),
            customer: z.union([
              stripeCustomerIdSchema,
              z.object({ id: stripeCustomerIdSchema }).passthrough(),
            ]),
            status: z.string().min(1).max(100),
            metadata: z.record(z.string(), z.string()).default({}),
            items: z
              .object({
                has_more: z.literal(false),
                data: z
                  .array(
                    z
                      .object({
                        price: z.object({ id: stripePriceIdSchema }).passthrough(),
                        current_period_start: stripeUnixSecondsSchema,
                        current_period_end: stripeUnixSecondsSchema,
                      })
                      .refine((value) => value.current_period_start < value.current_period_end, {
                        message: 'invalid subscription item period',
                      })
                      .passthrough(),
                  )
                  .min(1)
                  .max(100),
              })
              .passthrough(),
            cancel_at_period_end: z.boolean(),
            cancel_at: stripeUnixSecondsSchema.nullable(),
            canceled_at: stripeUnixSecondsSchema.nullable(),
            trial_end: stripeUnixSecondsSchema.nullable(),
          })
          .refine(
            (value) =>
              new Set(
                value.items.data.map(
                  (item) => `${item.current_period_start}:${item.current_period_end}`,
                ),
              ).size === 1,
            { message: 'subscription item periods disagree' },
          )
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough()
  .refine(
    (event) =>
      event.data.object.canceled_at === null || event.data.object.canceled_at <= event.created,
    { message: 'cancellation timestamp follows event creation' },
  );

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
  const period = subscription.items.data[0]!;
  const uniquePrices = [...new Set(subscription.items.data.map((item) => item.price.id))];
  const priceId = uniquePrices.length === 1 ? uniquePrices[0]! : null;
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
    priceId,
    plan: priceId ? planForStripePrice(priceId, prices) : null,
    state: normalizedState(event.type, subscription.status),
    currentPeriodStart: new Date(period.current_period_start * 1_000).toISOString(),
    currentPeriodEnd: new Date(period.current_period_end * 1_000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt:
      subscription.cancel_at === null
        ? null
        : new Date(subscription.cancel_at * 1_000).toISOString(),
    canceledAt:
      subscription.canceled_at === null
        ? null
        : new Date(subscription.canceled_at * 1_000).toISOString(),
    trialEnd:
      subscription.trial_end === null
        ? null
        : new Date(subscription.trial_end * 1_000).toISOString(),
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
      currentPeriodStart: period.current_period_start,
      currentPeriodEnd: period.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      cancelAt: subscription.cancel_at,
      canceledAt: subscription.canceled_at,
      trialEnd: subscription.trial_end,
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
    p_price_id: input.priceId,
    p_organization_id: input.organizationId,
    p_plan_key: input.plan,
    p_state: input.state,
    p_current_period_start: input.currentPeriodStart,
    p_current_period_end: input.currentPeriodEnd,
    p_cancel_at_period_end: input.cancelAtPeriodEnd,
    p_cancel_at: input.cancelAt,
    p_canceled_at: input.canceledAt,
    p_trial_end: input.trialEnd,
    p_payload: input.payload,
    p_payload_digest: input.payloadDigest,
  });
  if (error) throw new Error('subscription_event_application_failed');
  return applicationOutcomeSchema.parse(data);
}
