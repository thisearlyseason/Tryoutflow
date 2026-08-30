import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type {
  CheckoutIntentReservation,
  CheckoutIntentStore,
} from '../application/checkout-intent';

const reservationSchema = z.object({
  outcome: z.enum([
    'reserved',
    'pending',
    'completed',
    'in_progress',
    'conflict',
    'subscription_exists',
    'failed',
    'expired',
    'forbidden',
  ]),
  idempotency_key: z.string().nullable(),
  session_id: z.string().nullable(),
  result_url: z.string().nullable(),
});

export function createSubscriptionCheckoutIntentStore(
  ownerClient: SupabaseClient<Database>,
  serviceClient: SupabaseClient<Database>,
): CheckoutIntentStore {
  return {
    async reserve(input): Promise<CheckoutIntentReservation> {
      const result = await ownerClient.rpc('reserve_subscription_checkout_intent', {
        p_organization_id: input.organizationId,
        p_client_attempt_id: input.clientAttemptId,
        p_plan_key: input.plan,
      });
      if (result.error || !result.data[0]) throw new Error('checkout_reservation_failed');
      const row = reservationSchema.parse(result.data[0]);
      return {
        outcome: row.outcome,
        idempotencyKey: row.idempotency_key,
        sessionId: row.session_id,
        resultUrl: row.result_url,
      };
    },
    async complete(input) {
      const result = await serviceClient.rpc('complete_subscription_checkout_intent', {
        p_organization_id: input.organizationId,
        p_client_attempt_id: input.clientAttemptId,
        p_session_id: input.sessionId,
        p_result_url: input.resultUrl,
      });
      if (result.error) throw new Error('checkout_completion_failed');
      return result.data;
    },
    async fail(input) {
      const result = await serviceClient.rpc('fail_subscription_checkout_intent', {
        p_organization_id: input.organizationId,
        p_client_attempt_id: input.clientAttemptId,
      });
      if (result.error) throw new Error('checkout_failure_transition_failed');
      return result.data;
    },
  };
}
