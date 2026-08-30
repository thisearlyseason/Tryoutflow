import { describe, expect, it, vi } from 'vitest';

import {
  integrationPayloadDigest,
  previewRosterExport,
} from '../../../src/modules/integrations/application/preview-roster-export';
import { retrySyncJob } from '../../../src/modules/integrations/application/retry-sync-job';
import { startRosterExport } from '../../../src/modules/integrations/application/start-roster-export';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { TeamManagementProvider } from '../../../src/modules/integrations/domain/provider';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  actor: '10000000-0000-4000-8000-000000000002',
  connection: '10000000-0000-4000-8000-000000000003',
  tryout: '10000000-0000-4000-8000-000000000004',
  division: '10000000-0000-4000-8000-000000000005',
  roster: '10000000-0000-4000-8000-000000000006',
  team: '10000000-0000-4000-8000-000000000007',
  registration: '20000000-0000-4000-8000-000000000001',
  job: '10000000-0000-4000-8000-000000000008',
};

const owner = (): AuthorizationContext => ({
  userId: ids.actor as AuthorizationContext['userId'],
  organizationId: ids.organization as AuthorizationContext['organizationId'],
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
});

const member = (): AuthorizationContext => ({ ...owner(), organizationRole: 'member' });

const destination = {
  organization: {
    providerKey: 'the-squad',
    entityType: 'organization' as const,
    externalId: 'mock-org-001',
    displayName: 'Mock Organization 001',
    mockData: true,
  },
  season: {
    providerKey: 'the-squad',
    entityType: 'season' as const,
    externalId: 'mock-season-2026',
    displayName: 'Mock Season 2026',
    mockData: true,
  },
  division: {
    providerKey: 'the-squad',
    entityType: 'division' as const,
    externalId: 'mock-division-u18',
    displayName: 'Mock Division U18',
    mockData: true,
  },
  team: {
    providerKey: 'the-squad',
    entityType: 'team' as const,
    externalId: 'mock-team-blue',
    displayName: 'Mock Team Blue',
    mockData: true,
  },
  displayLabel: 'Mock Season 2026 / Mock Division U18 / Mock Team Blue',
  mockData: true,
};

const roster = {
  organizationId: ids.organization,
  tryoutId: ids.tryout,
  divisionId: ids.division,
  rosterVersionId: ids.roster,
  version: 3,
  state: 'finalized' as const,
  finalizedAt: '2026-08-30T12:00:00.000Z',
  teams: [{ id: ids.team, name: 'Blue' }],
  athletes: [
    {
      registrationId: ids.registration,
      firstName: 'Synthetic',
      lastName: 'Athlete',
      teamId: ids.team,
    },
  ],
};

const previewInput = {
  organizationId: ids.organization,
  connectionId: ids.connection,
  rosterVersionId: ids.roster,
  destination,
  approvedFields: ['first_name', 'last_name', 'team_name'] as const,
  correlationId: 'correlation:task27:preview',
};

function provider(): TeamManagementProvider {
  return {
    providerKey: 'the-squad',
    beginConnection: vi.fn(),
    completeConnection: vi.fn(),
    verifyConnection: vi.fn(),
    disconnect: vi.fn(),
    listOrganizations: vi.fn(),
    listDestinations: vi.fn(),
    previewAthleteImport: vi.fn(),
    importAthletes: vi.fn(),
    getSyncStatus: vi.fn(),
    previewRosterExport: vi.fn().mockImplementation(async (_context, request) => ({
      previewId: 'preview:task27:00000001',
      confirmationToken: 'confirmation:task27:00000001',
      snapshotDigest: integrationPayloadDigest(request),
      totalItems: 1,
      items: [
        {
          itemKey: `athlete:${ids.registration}`,
          registrationId: ids.registration,
          operation: 'create',
          displayLabel: 'Synthetic Athlete',
          fields: { firstName: 'Synthetic', lastName: 'Athlete', teamName: 'Blue' },
        },
      ],
      mockData: true,
    })),
    exportFinalizedRoster: vi.fn(),
  };
}

describe('durable roster export commands', () => {
  it('binds preview to the exact actor, connection, finalized snapshot, destination, and approved fields', async () => {
    const adapter = provider();
    const load = vi.fn().mockResolvedValue({
      outcome: 'ok',
      providerKey: 'the-squad',
      mockData: true,
      roster,
      sourceId: '10000000-0000-4000-8000-000000000009',
      sourceDigest: 'b'.repeat(64),
      existingAthleteIds: [],
    });
    const save = vi.fn().mockResolvedValue({ outcome: 'created' });

    const result = await previewRosterExport(previewInput, owner(), {
      gateway: { issuePreviewSource: load, savePreview: save },
      providers: { get: () => adapter },
    });

    expect(result).toMatchObject({ outcome: 'previewed', previewId: 'preview:task27:00000001' });
    expect(adapter.previewRosterExport).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ids.organization,
        actorId: ids.actor,
        connectionId: ids.connection,
      }),
      { destination, approvedFields: ['first_name', 'last_name', 'team_name'], roster },
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ids.organization,
        actorId: ids.actor,
        connectionId: ids.connection,
        rosterVersionId: ids.roster,
        destination,
        approvedFields: ['first_name', 'last_name', 'team_name'],
        previewId: 'preview:task27:00000001',
        sourceId: '10000000-0000-4000-8000-000000000009',
        sourceDigest: 'b'.repeat(64),
        payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }),
    );
  });

  it('fails closed before provider access for an unfinalized roster and an unauthorized actor', async () => {
    const adapter = provider();
    const unavailableGateway = {
      issuePreviewSource: vi.fn().mockResolvedValue({ outcome: 'invalid_state' }),
      savePreview: vi.fn(),
    };
    await expect(
      previewRosterExport(previewInput, owner(), {
        gateway: unavailableGateway,
        providers: { get: () => adapter },
      }),
    ).resolves.toEqual({ outcome: 'invalid_state' });
    await expect(
      previewRosterExport(previewInput, member(), {
        gateway: unavailableGateway,
        providers: { get: () => adapter },
      }),
    ).resolves.toEqual({ outcome: 'forbidden' });
    expect(adapter.previewRosterExport).not.toHaveBeenCalled();
  });

  it('rejects a provider preview whose digest does not match the immutable DB-issued request', async () => {
    const adapter = provider();
    vi.mocked(adapter.previewRosterExport).mockResolvedValueOnce({
      ...(await adapter.previewRosterExport(
        {
          organizationId: ids.organization,
          actorId: ids.actor,
          connectionId: ids.connection,
          correlationId: 'correlation:task27:seed',
          idempotencyKey: 'preview:task27:seed:0001',
        },
        { destination, approvedFields: [...previewInput.approvedFields], roster },
      )),
      snapshotDigest: 'f'.repeat(64),
    });
    const savePreview = vi.fn();
    await expect(
      previewRosterExport(previewInput, owner(), {
        gateway: {
          issuePreviewSource: vi.fn().mockResolvedValue({
            outcome: 'ok',
            providerKey: 'the-squad',
            mockData: true,
            roster,
            sourceId: '10000000-0000-4000-8000-000000000009',
            sourceDigest: 'b'.repeat(64),
            existingAthleteIds: [],
          }),
          savePreview,
        },
        providers: { get: () => adapter },
      }),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(savePreview).not.toHaveBeenCalled();
  });

  it('confirms an exact durable preview once and truthfully replays the same job', async () => {
    const confirm = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'queued', jobId: ids.job })
      .mockResolvedValueOnce({ outcome: 'replayed', jobId: ids.job });
    const input = {
      organizationId: ids.organization,
      previewId: 'preview:task27:00000001',
      confirmationToken: 'confirmation:task27:00000001',
      idempotencyKey: 'export:task27:00000001',
    };
    const dependencies = { gateway: { confirmPreview: confirm } };

    const first = await startRosterExport(input, owner(), dependencies);
    const second = await startRosterExport(input, owner(), dependencies);

    expect(first).toEqual({ outcome: 'queued', jobId: ids.job });
    expect(second).toEqual({ outcome: 'replayed', jobId: ids.job });
    expect(confirm).toHaveBeenNthCalledWith(1, { ...input, actorId: ids.actor });
  });

  it('retries only persisted failed or reviewable items and leaves completed items untouched', async () => {
    const retry = vi.fn().mockResolvedValue({
      outcome: 'queued',
      jobId: ids.job,
      retriedItemCount: 1,
      preservedCompletedItemCount: 1,
    });

    const result = await retrySyncJob(
      {
        organizationId: ids.organization,
        jobId: ids.job,
        idempotencyKey: 'retry:task27:00000001',
      },
      owner(),
      { gateway: { retry } },
    );

    expect(result).toEqual({
      outcome: 'queued',
      jobId: ids.job,
      retriedItemCount: 1,
      preservedCompletedItemCount: 1,
    });
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: ids.actor, jobId: ids.job }),
    );
  });
});
