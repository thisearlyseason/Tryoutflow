import { describe, expect, it } from 'vitest';

import { FixedClock } from '../../../src/lib/clock';
import { parseAuditEntityId, parseOrganizationId, parseUserId } from '../../../src/lib/ids';
import {
  appendAuditEvent,
  type AuditEvent,
  type AuditWriter,
} from '../../../src/modules/audit/application/append-audit-event';

describe('appendAuditEvent', () => {
  it('records a timestamped, metadata-free audit event through the writer', async () => {
    const events: AuditEvent[] = [];
    const writer: AuditWriter = {
      async append(event) {
        events.push(event);
      },
    };
    const occurredAt = new Date('2026-08-28T12:00:00.000Z');

    await appendAuditEvent(writer, new FixedClock(occurredAt), {
      organizationId: parseOrganizationId('6053b548-2bd8-4c57-9c13-c1381e4d29cc'),
      actorId: parseUserId('0c9cbb1d-1e53-4ddf-b3dc-ec55bd2f5df5'),
      action: 'organization.created',
      entityType: 'organization',
      entityId: parseAuditEntityId('6053b548-2bd8-4c57-9c13-c1381e4d29cc'),
    });

    expect(events).toEqual([
      {
        organizationId: '6053b548-2bd8-4c57-9c13-c1381e4d29cc',
        actorId: '0c9cbb1d-1e53-4ddf-b3dc-ec55bd2f5df5',
        action: 'organization.created',
        entityType: 'organization',
        entityId: '6053b548-2bd8-4c57-9c13-c1381e4d29cc',
        occurredAt,
      },
    ]);
  });
});
