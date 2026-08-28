import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { Clock } from '../../../lib/clock';
import { SystemClock } from '../../../lib/clock';
import type { OrganizationId, UserId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from './capabilities';
import { requireCapability } from './require-capability';
import { defaultOrganizationGateway } from './organization-dependencies';
import { NoopInvitationNotifier } from './invitation-notifier';
import type { InvitationNotifier, OrganizationGateway } from '../domain/organization';

const schema = z.object({
  organizationId: z.uuid(),
  email: z.email(),
  role: z.enum(['administrator', 'member']),
});
export type InviteMemberError = { code: 'invalid_input' | 'forbidden' | 'conflict' | 'unexpected' };

export function invitationTokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function inviteMember(
  input: unknown,
  actor: { userId: UserId; authorization: AuthorizationContext },
  dependencies: {
    gateway?: OrganizationGateway;
    notifier?: InvitationNotifier;
    clock?: Clock;
    tokenGenerator?: () => string;
  } = {},
): Promise<AppResult<{ invitationId: string }, InviteMemberError>> {
  const parsed = schema.safeParse(
    typeof input === 'object' && input !== null
      ? {
          ...input,
          email:
            typeof (input as { email?: unknown }).email === 'string'
              ? (input as { email: string }).email.trim().toLowerCase()
              : (input as { email?: unknown }).email,
        }
      : input,
  );
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (!requireCapability(actor.authorization, 'membership:manage', { organizationId }).ok)
    return failure({ code: 'forbidden' });
  const token = dependencies.tokenGenerator?.() ?? randomBytes(32).toString('base64url');
  const clock = dependencies.clock ?? new SystemClock();
  const expiresAt = new Date(clock.now().getTime() + 7 * 24 * 60 * 60 * 1000);
  try {
    const invitation = await (
      dependencies.gateway ?? (await defaultOrganizationGateway())
    ).createInvitation({
      id: randomUUID(),
      organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
      tokenDigest: invitationTokenDigest(token),
      expiresAt,
      createdByUserId: actor.userId,
    });
    await (dependencies.notifier ?? new NoopInvitationNotifier()).enqueue({
      invitationId: invitation.id,
      organizationId,
      email: parsed.data.email,
      token,
      expiresAt,
    });
    return success({ invitationId: invitation.id });
  } catch (error) {
    return failure({
      code: (error as { code?: string }).code === '23505' ? 'conflict' : 'unexpected',
    });
  }
}
