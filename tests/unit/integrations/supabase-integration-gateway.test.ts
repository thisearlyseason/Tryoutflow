import { describe, expect, it, vi } from 'vitest';

import { SupabaseIntegrationGateway } from '../../../src/modules/integrations/infrastructure/supabase-integration-gateway';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  actor: '10000000-0000-4000-8000-000000000002',
  connection: '10000000-0000-4000-8000-000000000003',
  roster: '10000000-0000-4000-8000-000000000006',
  tryout: '10000000-0000-4000-8000-000000000004',
  division: '10000000-0000-4000-8000-000000000005',
  team: '10000000-0000-4000-8000-000000000007',
  registration: '20000000-0000-4000-8000-000000000001',
  job: '10000000-0000-4000-8000-000000000008',
};

const roster = {
  organizationId: ids.organization,
  tryoutId: ids.tryout,
  divisionId: ids.division,
  rosterVersionId: ids.roster,
  version: 3,
  state: 'finalized',
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
const destination = {
  organization: {
    providerKey: 'the-squad',
    entityType: 'organization' as const,
    externalId: 'mock-org',
    displayName: 'Mock org',
    mockData: true,
  },
  season: {
    providerKey: 'the-squad',
    entityType: 'season' as const,
    externalId: 'mock-season',
    displayName: 'Mock season',
    mockData: true,
  },
  division: {
    providerKey: 'the-squad',
    entityType: 'division' as const,
    externalId: 'mock-division',
    displayName: 'Mock division',
    mockData: true,
  },
  team: {
    providerKey: 'the-squad',
    entityType: 'team' as const,
    externalId: 'mock-team',
    displayName: 'Mock team',
    mockData: true,
  },
  displayLabel: 'Mock destination',
  mockData: true,
};

describe('SupabaseIntegrationGateway', () => {
  it('parses the finalized roster context and rejects malformed RPC projections', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: 'ok',
        source_id: ids.job,
        source_digest: 'a'.repeat(64),
        existing_athlete_ids: [],
        provider_key: 'the-squad',
        mock_data: true,
        roster,
      },
      error: null,
    });
    const gateway = new SupabaseIntegrationGateway({ rpc } as never);

    await expect(
      gateway.issuePreviewSource({
        organizationId: ids.organization,
        actorId: ids.actor,
        connectionId: ids.connection,
        rosterVersionId: ids.roster,
        destination,
        approvedFields: ['first_name'],
      }),
    ).resolves.toMatchObject({ outcome: 'ok', providerKey: 'the-squad', roster });

    rpc.mockResolvedValueOnce({
      data: {
        outcome: 'ok',
        source_id: ids.job,
        source_digest: 'a'.repeat(64),
        existing_athlete_ids: [],
        provider_key: 'the-squad',
        mock_data: true,
        roster: {},
      },
      error: null,
    });
    await expect(
      gateway.issuePreviewSource({
        organizationId: ids.organization,
        actorId: ids.actor,
        connectionId: ids.connection,
        rosterVersionId: ids.roster,
        destination,
        approvedFields: ['first_name'],
      }),
    ).rejects.toThrow('Invalid integration roster context');
  });

  it('maps exact confirmation and retry RPC outcomes', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          outcome: 'queued',
          job_id: ids.job,
          state: 'pending',
          item_count: 1,
          completed_count: 0,
          skipped_count: 0,
          failed_count: 0,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          outcome: 'queued',
          job_id: ids.job,
          retried_item_count: 1,
          preserved_completed_item_count: 2,
          preserved_skipped_item_count: 1,
          state: 'pending',
        },
        error: null,
      });
    const gateway = new SupabaseIntegrationGateway({ rpc } as never);

    await expect(
      gateway.confirmPreview({
        organizationId: ids.organization,
        actorId: ids.actor,
        previewId: 'preview:task27:00000001',
        confirmationToken: 'confirmation:task27:00000001',
        idempotencyKey: 'export:task27:00000001',
      }),
    ).resolves.toEqual({
      outcome: 'queued',
      jobId: ids.job,
      state: 'pending',
      itemCount: 1,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    await expect(
      gateway.retry({
        organizationId: ids.organization,
        actorId: ids.actor,
        jobId: ids.job,
        idempotencyKey: 'retry:task27:00000001',
      }),
    ).resolves.toEqual({
      outcome: 'queued',
      jobId: ids.job,
      retriedItemCount: 1,
      preservedCompletedItemCount: 2,
      preservedSkippedItemCount: 1,
    });
  });

  it('persists the exact actor-scoped demo connection through the narrow RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'connected', error: null });
    const gateway = new SupabaseIntegrationGateway({ rpc } as never);
    await expect(
      gateway.saveConnection({
        organizationId: ids.organization,
        actorId: ids.actor,
        providerKey: 'the-squad',
        connectionId: ids.connection,
        displayName: 'The Squad (demo/mock)',
        mockData: true,
      }),
    ).resolves.toBe('connected');
    expect(rpc).toHaveBeenCalledWith('save_integration_connection', {
      p_organization_id: ids.organization,
      p_provider_key: 'the-squad',
      p_connection_id: ids.connection,
      p_display_name: 'The Squad (demo/mock)',
      p_mock_data: true,
    });
  });
});
