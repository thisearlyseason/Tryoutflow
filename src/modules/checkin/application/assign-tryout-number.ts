import type { OrganizationId } from '../../../lib/ids';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { scopeMatchesPlacement, type NumberScope } from '../domain/number-scope';

export type NumberAssignmentResult =
  | { outcome: 'assigned' | 'replayed' | 'corrected'; number: number }
  | { outcome: 'number_conflict'; number: null; nextAvailable: number }
  | {
      outcome:
        | 'forbidden'
        | 'invalid_registration'
        | 'invalid_placement'
        | 'invalid_request'
        | 'withdrawn'
        | 'cancelled'
        | 'exhausted';
      number: null;
    };

export type NumberAssignmentGateway = {
  assign(input: {
    organizationId: string;
    tryoutId: string;
    registrationId: string;
    divisionId: string;
    sessionId?: string;
    groupId?: string;
    scope: NumberScope;
    requested?: number;
  }): Promise<NumberAssignmentResult>;
};

export async function assignTryoutNumber(
  input: {
    organizationId: OrganizationId;
    tryoutId: string;
    registrationId: string;
    divisionId: string;
    sessionId?: string;
    groupId?: string;
    scope: NumberScope;
    requested?: number;
  },
  actor: AuthorizationContext,
  gateway: NumberAssignmentGateway,
): Promise<NumberAssignmentResult> {
  if (
    !scopeMatchesPlacement(input.scope, input) ||
    (input.requested !== undefined &&
      (!Number.isSafeInteger(input.requested) || input.requested < 1 || input.requested > 9999)) ||
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
  return gateway.assign(input);
}
