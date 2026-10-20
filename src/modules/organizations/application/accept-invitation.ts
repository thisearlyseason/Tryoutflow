import { z } from 'zod';

import type { UserId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import { invitationTokenDigest } from './invite-member';
import { defaultOrganizationGateway } from './organization-dependencies';
import type { OrganizationGateway } from '../domain/organization';

export type AcceptInvitationError = {
  code: 'invalid' | 'expired' | 'wrong_email' | 'duplicate_membership' | 'unverified';
};
const tokenSchema = z.string().min(32).max(512);

export async function acceptInvitation(
  token: string,
  _actor: { userId: UserId; email: string },
  dependencies: { gateway?: OrganizationGateway } = {},
): Promise<
  AppResult<
    { organizationId: import('../../../lib/ids').OrganizationId; organizationSlug: string },
    AcceptInvitationError
  >
> {
  if (!tokenSchema.safeParse(token).success) return failure({ code: 'invalid' });
  const result = await (
    dependencies.gateway ?? (await defaultOrganizationGateway())
  ).acceptInvitation(invitationTokenDigest(token));
  return result.kind === 'accepted'
    ? success({ organizationId: result.organizationId, organizationSlug: result.organizationSlug })
    : failure({ code: result.kind });
}
