import type { OrganizationId } from '../../../lib/ids';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

export type CheckinReceipt = {
  outcome: 'checked_in' | 'already_checked_in';
  receiptId: string;
  checkedInAt: string;
  assignedNumber: number;
};

export type CheckinResult =
  | CheckinReceipt
  | {
      outcome:
        | 'withdrawn'
        | 'cancelled'
        | 'missing_information'
        | 'invalid_registration'
        | 'number_conflict'
        | 'capacity'
        | 'invalid_placement'
        | 'forbidden'
        | 'invalid_request'
        | 'exhausted'
        | 'conflict'
        | 'retryable_contention';
      nextAvailable?: number;
    };

export type CheckinGateway = {
  checkIn(input: {
    organizationId: string;
    tryoutId: string;
    registrationId: string;
    divisionId: string;
    sessionId: string;
    groupId?: string;
    idempotencyKey: string;
    numberScope?: 'tryout' | 'division' | 'session' | 'group';
    requestedNumber?: number;
  }): Promise<CheckinResult>;
};

export async function checkInAthlete(
  input: {
    organizationId: OrganizationId;
    tryoutId: string;
    registrationId: string;
    divisionId: string;
    sessionId: string;
    groupId?: string;
    idempotencyKey: string;
    numberScope?: 'tryout' | 'division' | 'session' | 'group';
    requestedNumber?: number;
  },
  actor: AuthorizationContext,
  gateway: CheckinGateway,
): Promise<CheckinResult> {
  if (
    !/^[A-Za-z0-9_-]{24,200}$/u.test(input.idempotencyKey) ||
    (input.requestedNumber !== undefined &&
      (!Number.isSafeInteger(input.requestedNumber) ||
        input.requestedNumber < 1 ||
        input.requestedNumber > 9999)) ||
    !requireCapability(actor, 'checkin:write', {
      organizationId: input.organizationId,
      tryoutId: input.tryoutId,
      divisionId: input.divisionId,
      sessionId: input.sessionId,
      groupId: input.groupId,
    }).ok
  ) {
    throw { code: 'forbidden' as const };
  }
  return gateway.checkIn(input);
}
