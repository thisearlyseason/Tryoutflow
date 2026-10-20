import { z } from 'zod';

import { providerMessageIdSchema } from '../../../infrastructure/email/email-provider';

export type MessageDeliveryState =
  | 'queued'
  | 'delivery_uncertain'
  | 'submitted'
  | 'delivery_delayed'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'suppressed'
  | 'complained';
export type DeliveryEventType =
  'sent' | 'delivery_delayed' | 'delivered' | 'failed' | 'bounced' | 'suppressed' | 'complained';

const precedence: Record<MessageDeliveryState | DeliveryEventType, number> = {
  queued: 0,
  delivery_uncertain: 1,
  submitted: 2,
  sent: 2,
  delivery_delayed: 3,
  delivered: 4,
  failed: 5,
  bounced: 6,
  suppressed: 7,
  complained: 8,
};

const eventToState: Record<DeliveryEventType, MessageDeliveryState> = {
  sent: 'submitted',
  delivery_delayed: 'delivery_delayed',
  delivered: 'delivered',
  failed: 'failed',
  bounced: 'bounced',
  suppressed: 'suppressed',
  complained: 'complained',
};

export function applyDeliveryEvent(
  current: MessageDeliveryState,
  event: DeliveryEventType,
): MessageDeliveryState {
  const candidate = eventToState[event];
  return precedence[candidate] > precedence[current] ? candidate : current;
}

const resendEventSchema = z
  .object({
    type: z.enum([
      'email.sent',
      'email.delivery_delayed',
      'email.delivered',
      'email.failed',
      'email.bounced',
      'email.suppressed',
      'email.complained',
    ]),
    created_at: z.iso.datetime({ offset: true }),
    data: z
      .object({
        email_id: providerMessageIdSchema,
        tags: z.object({ message_id: z.uuid() }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export function parseResendEvent(input: unknown) {
  const event = resendEventSchema.parse(input);
  return {
    type: event.type.slice('email.'.length) as DeliveryEventType,
    occurredAt: event.created_at,
    providerMessageId: event.data.email_id,
    messageId: event.data.tags.message_id,
  } as const;
}

type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function recordDeliveryEvent(
  eventId: string,
  input: ReturnType<typeof parseResendEvent>,
  client: RpcClient,
) {
  const { data, error } = await client.rpc('apply_resend_delivery_event', {
    p_event_id: eventId,
    p_message_id: input.messageId,
    p_provider_message_id: input.providerMessageId,
    p_event_type: input.type,
    p_occurred_at: input.occurredAt,
  });
  if (error) throw new Error('delivery_event_failed');
  return String(data);
}
