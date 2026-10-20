import type { UserId } from '../../../lib/ids';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import {
  inviteMember,
  type InviteMemberError,
  type InvitationDelivery,
} from '../../organizations/application/invite-member';
import type {
  InvitationNotifier,
  OrganizationGateway,
} from '../../organizations/domain/organization';
import type { Clock } from '../../../lib/clock';
import type { AppResult } from '../../../lib/result';

export function inviteEvaluator(
  input: { organizationId: string; email: string },
  actor: { userId: UserId; authorization: AuthorizationContext },
  dependencies: {
    gateway?: OrganizationGateway;
    notifier?: InvitationNotifier;
    clock?: Clock;
    tokenGenerator?: () => string;
    applicationOrigin?: string;
  } = {},
): Promise<
  AppResult<
    { invitationId: string; delivery: InvitationDelivery; shareUrl: string; expiresAt: string },
    InviteMemberError
  >
> {
  return inviteMember({ ...input, role: 'member' }, actor, dependencies);
}
