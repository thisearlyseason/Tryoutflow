import type { OrganizationId, UserId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

export type AuditListEvent = Readonly<{
  id: string;
  organizationId: OrganizationId;
  actorId: UserId | null;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
}>;

export interface AuditEventListGateway {
  findAuthorizationContext(
    actorId: UserId,
    organizationId: OrganizationId,
  ): Promise<AuthorizationContext | null>;
  listEvents(organizationId: OrganizationId, limit: number): Promise<readonly AuditListEvent[]>;
}

export type ListAuditEventsError = Readonly<{
  code: 'forbidden' | 'invalid_limit' | 'audit_unavailable';
}>;

export async function listAuditEvents(
  input: Readonly<{ actorId: UserId; organizationId: OrganizationId; limit?: number }>,
  gateway: AuditEventListGateway,
): Promise<AppResult<readonly AuditListEvent[], ListAuditEventsError>> {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return failure({ code: 'invalid_limit' });
  }
  try {
    const authorization = await gateway.findAuthorizationContext(
      input.actorId,
      input.organizationId,
    );
    if (
      !authorization ||
      !requireCapability(authorization, 'audit:read', {
        organizationId: input.organizationId,
      }).ok
    ) {
      return failure({ code: 'forbidden' });
    }
    return success(await gateway.listEvents(input.organizationId, limit));
  } catch {
    return failure({ code: 'audit_unavailable' });
  }
}
