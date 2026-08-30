import type { OrganizationId } from '../../../lib/ids';
import type { PaidPlanKey } from '../domain/plans';

export type CheckoutIntentReservation = Readonly<{
  outcome:
    | 'reserved'
    | 'pending'
    | 'completed'
    | 'in_progress'
    | 'conflict'
    | 'subscription_exists'
    | 'failed'
    | 'expired'
    | 'forbidden';
  idempotencyKey: string | null;
  sessionId: string | null;
  resultUrl: string | null;
}>;

export interface CheckoutIntentStore {
  reserve(input: {
    organizationId: OrganizationId;
    clientAttemptId: string;
    plan: PaidPlanKey;
  }): Promise<CheckoutIntentReservation>;
  complete(input: {
    organizationId: OrganizationId;
    clientAttemptId: string;
    sessionId: string;
    resultUrl: string;
  }): Promise<string>;
  fail(input: { organizationId: OrganizationId; clientAttemptId: string }): Promise<string>;
}
