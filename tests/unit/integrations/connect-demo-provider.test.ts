import { describe, expect, it, vi } from 'vitest';

import { connectDemoProvider } from '../../../src/modules/integrations/application/connect-demo-provider';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { TeamManagementProvider } from '../../../src/modules/integrations/domain/provider';

const organizationId = '10000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000002';
const connectionId = '10000000-0000-4000-8000-000000000003';
const owner: AuthorizationContext = {
  organizationId: organizationId as AuthorizationContext['organizationId'],
  userId: actorId as AuthorizationContext['userId'],
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

const provider = (): TeamManagementProvider => ({
  providerKey: 'the-squad',
  beginConnection: vi.fn().mockResolvedValue({
    mode: 'mock',
    challengeId: 'challenge:task27:0000001',
    expiresAt: '2099-01-01T00:00:00.000Z',
    displayLabel: 'The Squad (demo/mock — no live transfer)',
    mockData: true,
  }),
  completeConnection: vi.fn().mockResolvedValue({
    connectionId,
    providerKey: 'the-squad',
    state: 'connected',
    displayName: 'The Squad (demo/mock)',
    connectedAt: '2026-08-30T00:00:00.000Z',
    mockData: true,
  }),
  verifyConnection: vi.fn(),
  disconnect: vi.fn(),
  listOrganizations: vi.fn(),
  listDestinations: vi.fn(),
  previewAthleteImport: vi.fn(),
  importAthletes: vi.fn(),
  previewRosterExport: vi.fn(),
  exportFinalizedRoster: vi.fn(),
  getSyncStatus: vi.fn(),
});

describe('connectDemoProvider', () => {
  it('persists only an explicitly mock-labeled connection for the exact actor and organization', async () => {
    const adapter = provider();
    const saveConnection = vi.fn().mockResolvedValue('connected');
    await expect(
      connectDemoProvider(
        {
          organizationId,
          correlationId: 'correlation:task27:connect',
          idempotencyKey: 'connection:task27:0001',
        },
        owner,
        { providers: { get: () => adapter }, gateway: { saveConnection } },
      ),
    ).resolves.toEqual({ outcome: 'connected', connectionId });
    expect(saveConnection).toHaveBeenCalledWith({
      organizationId,
      actorId,
      providerKey: 'the-squad',
      connectionId,
      displayName: 'The Squad (demo/mock)',
      mockData: true,
    });
  });

  it('fails closed when the feature-flagged provider is unavailable', async () => {
    await expect(
      connectDemoProvider(
        {
          organizationId,
          correlationId: 'correlation:task27:connect',
          idempotencyKey: 'connection:task27:0001',
        },
        owner,
        {
          providers: {
            get: () => {
              throw new Error('provider_disabled');
            },
          },
          gateway: { saveConnection: vi.fn() },
        },
      ),
    ).resolves.toEqual({ outcome: 'provider_disabled' });
  });
});
