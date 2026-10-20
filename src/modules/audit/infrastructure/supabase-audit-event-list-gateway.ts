import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import { parseOrganizationId, parseUserId, type OrganizationId } from '../../../lib/ids';
import type { AuditEventListGateway, AuditListEvent } from '../application/list-audit-events';

type AuthorizationLoader = Pick<AuditEventListGateway, 'findAuthorizationContext'>;

export class SupabaseAuditEventListGateway implements AuditEventListGateway {
  constructor(
    private readonly client: SupabaseClient<Database>,
    private readonly authorization: AuthorizationLoader,
  ) {}

  findAuthorizationContext: AuditEventListGateway['findAuthorizationContext'] = (
    actorId,
    organizationId,
  ) => this.authorization.findAuthorizationContext(actorId, organizationId);

  async listEvents(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<readonly AuditListEvent[]> {
    const result = await this.client
      .from('audit_logs')
      .select('id,organization_id,actor_user_id,action,entity_type,entity_id,occurred_at')
      .eq('organization_id', organizationId)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (result.error) throw result.error;
    return result.data.map((event) => ({
      id: event.id,
      organizationId: parseOrganizationId(event.organization_id),
      actorId: event.actor_user_id ? parseUserId(event.actor_user_id) : null,
      action: event.action,
      entityType: event.entity_type,
      entityId: event.entity_id,
      occurredAt: event.occurred_at,
    }));
  }
}
