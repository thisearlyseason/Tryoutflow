import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { Clock } from '../../../lib/clock';
import { SystemClock } from '../../../lib/clock';
import type { OrganizationId, UserId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from './capabilities';
import { requireCapability } from './require-capability';
import { defaultOrganizationGateway } from './organization-dependencies';
import { getPublicAppOrigin } from '../../../lib/env';
import type { InvitationNotifier, OrganizationGateway } from '../domain/organization';

const schema = z.object({
  organizationId: z.uuid(),
  email: z.email(),
  role: z.enum(['administrator', 'member']),
});
export type InviteMemberError = { code: 'invalid_input' | 'forbidden' | 'conflict' | 'unexpected' };
export type InvitationDelivery = 'manual_share' | 'notifier_enqueued';

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
    applicationOrigin?: string;
  } = {},
): Promise<
  AppResult<
    { invitationId: string; delivery: InvitationDelivery; shareUrl: string; expiresAt: string },
    InviteMemberError
  >
> {
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
    const origin = getPublicAppOrigin(
      dependencies.applicationOrigin
        ? { ...process.env, NEXT_PUBLIC_APP_URL: dependencies.applicationOrigin }
        : process.env,
    );
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
    let delivery: InvitationDelivery = 'manual_share';
    if (dependencies.notifier) {
      try {
        await dependencies.notifier.enqueue({
          invitationId: invitation.id,
          organizationId,
          email: parsed.data.email,
          token,
          expiresAt,
        });
        delivery = 'notifier_enqueued';
      } catch {
        // The caller receives the ephemeral one-time URL instead of a false delivery claim.
      }
    }
    return success({
      invitationId: invitation.id,
      delivery,
      shareUrl: new URL(`/invite/${token}`, origin).toString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    return failure({
      code: (error as { code?: string }).code === '23505' ? 'conflict' : 'unexpected',
    });
  }
}
