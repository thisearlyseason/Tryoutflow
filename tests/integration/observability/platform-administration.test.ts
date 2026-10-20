// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../../src/lib/clock';
import { parseOrganizationId, parseUserId } from '../../../src/lib/ids';
import {
  listAuditEvents,
  type AuditEventListGateway,
} from '../../../src/modules/audit/application/list-audit-events';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  beginSupportElevation,
  type SupportElevationGateway,
} from '../../../src/modules/organizations/application/begin-support-elevation';

const organizationId = parseOrganizationId('11111111-1111-4111-8111-111111111111');
const actorId = parseUserId('22222222-2222-4222-8222-222222222222');
const now = new Date('2026-08-31T18:00:00.000Z');
const owner: AuthorizationContext = {
  userId: actorId,
  organizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

describe('organization audit history', () => {
  it('reauthorizes current membership before reading immutable audit fields', async () => {
    const listEvents = vi.fn();
    const gateway: AuditEventListGateway = {
      findAuthorizationContext: async () => null,
      listEvents,
    };

    await expect(listAuditEvents({ actorId, organizationId, limit: 20 }, gateway)).resolves.toEqual(
      { ok: false, error: { code: 'forbidden' } },
    );
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('returns only the audit event allow-list for a current owner', async () => {
    const gateway: AuditEventListGateway = {
      findAuthorizationContext: async () => owner,
      listEvents: async () => [
        {
          id: '33333333-3333-4333-8333-333333333333',
          organizationId,
          actorId,
          action: 'platform.support_elevation.started',
          entityType: 'platform_support_elevation',
          entityId: '44444444-4444-4444-8444-444444444444',
          occurredAt: '2026-08-31T18:00:00.000Z',
        },
      ],
    };

    await expect(listAuditEvents({ actorId, organizationId, limit: 20 }, gateway)).resolves.toEqual(
      {
        ok: true,
        value: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            organizationId,
            actorId,
            action: 'platform.support_elevation.started',
            entityType: 'platform_support_elevation',
            entityId: '44444444-4444-4444-8444-444444444444',
            occurredAt: '2026-08-31T18:00:00.000Z',
          },
        ],
      },
    );
  });
});

describe('support elevation boundary', () => {
  it('rejects missing, unsafe, or unbounded reasons and expiries before the database call', async () => {
    const begin = vi.fn();
    const gateway: SupportElevationGateway = { begin };
    const cases = [
      { reason: 'short', expiresAt: new Date('2026-08-31T18:30:00.000Z') },
      {
        reason: 'Ticket T32-100\nprivate raw payload',
        expiresAt: new Date('2026-08-31T18:30:00.000Z'),
      },
      {
        reason: 'Investigate support ticket T32-100',
        expiresAt: new Date('2026-08-31T18:01:00.000Z'),
      },
      {
        reason: 'Investigate support ticket T32-100',
        expiresAt: new Date('2026-08-31T23:00:00.000Z'),
      },
    ];

    const results = await Promise.all(
      cases.map((input) =>
        beginSupportElevation({ organizationId, ...input }, gateway, new FixedClock(now)),
      ),
    );

    expect(results).toEqual([
      { ok: false, error: { code: 'invalid_reason' } },
      { ok: false, error: { code: 'invalid_reason' } },
      { ok: false, error: { code: 'invalid_expiry' } },
      { ok: false, error: { code: 'invalid_expiry' } },
    ]);
    expect(begin).not.toHaveBeenCalled();
  });

  it('submits a trimmed self-elevation request and preserves the guarded outcome', async () => {
    const expiresAt = new Date('2026-08-31T18:30:00.000Z');
    const gateway: SupportElevationGateway = {
      begin: async (input) => {
        expect(input).toEqual({
          organizationId,
          reason: 'Investigate support ticket T32-100',
          expiresAt,
        });
        return {
          outcome: 'started',
          elevationId: '55555555-5555-4555-8555-555555555555',
          expiresAt: expiresAt.toISOString(),
        };
      },
    };

    await expect(
      beginSupportElevation(
        { organizationId, reason: '  Investigate support ticket T32-100  ', expiresAt },
        gateway,
        new FixedClock(now),
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        elevationId: '55555555-5555-4555-8555-555555555555',
        expiresAt: '2026-08-31T18:30:00.000Z',
      },
    });
  });
});
