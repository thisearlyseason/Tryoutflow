import type { Clock } from '@/lib/clock';
import type { AuditEntityId, OrganizationId, UserId } from '@/lib/ids';

export type AuditEvent = {
  organizationId: OrganizationId;
  actorId: UserId | null;
  action: string;
  entityType: string;
  entityId: AuditEntityId;
  occurredAt: Date;
};

export type NewAuditEvent = Omit<AuditEvent, 'occurredAt'>;

export interface AuditWriter {
  append(event: AuditEvent): Promise<void>;
}

export async function appendAuditEvent(
  writer: AuditWriter,
  clock: Clock,
  event: NewAuditEvent,
): Promise<void> {
  await writer.append({
    ...event,
    occurredAt: clock.now(),
  });
}
