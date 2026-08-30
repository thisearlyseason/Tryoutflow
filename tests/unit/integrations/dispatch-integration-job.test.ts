// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  dispatchIntegrationJob,
  type ClaimedIntegrationJob,
} from '../../../src/infrastructure/integrations/dispatch-integration-job';
import type { TeamManagementProvider } from '../../../src/modules/integrations/domain/provider';

const ids = {
  outbox: '10000000-0000-4000-8000-000000000001',
  job: '10000000-0000-4000-8000-000000000002',
  organization: '10000000-0000-4000-8000-000000000003',
  connection: '10000000-0000-4000-8000-000000000004',
  actor: '10000000-0000-4000-8000-000000000005',
  tryout: '10000000-0000-4000-8000-000000000006',
  division: '10000000-0000-4000-8000-000000000007',
  roster: '10000000-0000-4000-8000-000000000008',
  team: '10000000-0000-4000-8000-000000000009',
  registration: '20000000-0000-4000-8000-000000000001',
  lease: '10000000-0000-4000-8000-000000000010',
};

const job: ClaimedIntegrationJob = {
  outboxJobId: ids.outbox,
  syncJobId: ids.job,
  organizationId: ids.organization,
  connectionId: ids.connection,
  providerKey: 'the-squad',
  actorUserId: ids.actor,
  leaseToken: ids.lease,
  leaseGeneration: 1,
  leaseExpiresAt: '2099-01-01T00:00:00.000Z',
  providerIdempotencyKey: `integration:${ids.job}:1`,
  attemptNumber: 1,
  itemKeys: [`athlete:${ids.registration}`],
  confirmedRequest: {
    destination: {
      organization: {
        providerKey: 'the-squad',
        entityType: 'organization',
        externalId: 'mock-org-001',
        displayName: 'Mock Organization 001',
        mockData: true,
      },
      season: {
        providerKey: 'the-squad',
        entityType: 'season',
        externalId: 'mock-season-2026',
        displayName: 'Mock Season 2026',
        mockData: true,
      },
      division: {
        providerKey: 'the-squad',
        entityType: 'division',
        externalId: 'mock-division-u18',
        displayName: 'Mock Division U18',
        mockData: true,
      },
      team: {
        providerKey: 'the-squad',
        entityType: 'team',
        externalId: 'mock-team-blue',
        displayName: 'Mock Team Blue',
        mockData: true,
      },
      displayLabel: 'Mock Season 2026 / Mock Division U18 / Mock Team Blue',
      mockData: true,
    },
    approvedFields: ['first_name', 'last_name', 'team_name'],
    roster: {
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
    },
    previewId: 'preview:task27:00000001',
    confirmationToken: 'confirmation:task27:00000001',
  },
};

function provider(): TeamManagementProvider {
  return {
    providerKey: 'the-squad',
    beginConnection: vi.fn(),
    completeConnection: vi.fn(),
    verifyConnection: vi.fn().mockResolvedValue({
      state: 'healthy',
      checkedAt: '2026-08-30T12:00:00.000Z',
      mockData: true,
    }),
    disconnect: vi.fn(),
    listOrganizations: vi.fn(),
    listDestinations: vi.fn(),
    previewAthleteImport: vi.fn(),
    importAthletes: vi.fn(),
    previewRosterExport: vi.fn().mockResolvedValue({
      previewId: 'preview:retry:000000001',
      confirmationToken: 'confirmation:retry:0001',
      snapshotDigest: 'a'.repeat(64),
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
    }),
    exportFinalizedRoster: vi.fn().mockResolvedValue({
      externalJobId: 'mock-job-001',
      state: 'completed',
      items: [
        {
          itemKey: `athlete:${ids.registration}`,
          entityType: 'athlete',
          state: 'completed',
          attempts: 1,
          externalRef: {
            providerKey: 'the-squad',
            entityType: 'athlete',
            externalId: 'mock-athlete-001',
            displayName: 'Synthetic Athlete',
            mockData: true,
          },
          error: null,
        },
      ],
      mockData: true,
    }),
    getSyncStatus: vi.fn(),
  };
}

describe('dispatchIntegrationJob', () => {
  it('fences submission before provider handoff and persists the normalized terminal result', async () => {
    const adapter = provider();
    const validateExecution = vi.fn().mockResolvedValue('authorized');
    const authorize = vi.fn().mockResolvedValue('authorized');
    const complete = vi.fn().mockResolvedValue('completed');
    const fail = vi.fn();

    await expect(
      dispatchIntegrationJob(job, {
        providers: { get: () => adapter },
        gateway: { validateExecution, authorize, complete, fail },
      }),
    ).resolves.toBe('completed');

    expect(validateExecution).toHaveBeenCalledTimes(2);
    expect(validateExecution.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(adapter.verifyConnection).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(adapter.verifyConnection).mock.invocationCallOrder[0]).toBeLessThan(
      validateExecution.mock.invocationCallOrder[1]!,
    );
    expect(validateExecution.mock.invocationCallOrder[1]).toBeLessThan(
      authorize.mock.invocationCallOrder[0]!,
    );
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(adapter.exportFinalizedRoster).mock.invocationCallOrder[0]!,
    );
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(vi.mocked(adapter.exportFinalizedRoster).mock.invocationCallOrder[0]).toBeLessThan(
      authorize.mock.invocationCallOrder[1]!,
    );
    expect(authorize.mock.invocationCallOrder[1]).toBeLessThan(
      complete.mock.invocationCallOrder[0]!,
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outboxJobId: ids.outbox,
        externalJobId: 'mock-job-001',
        result: expect.objectContaining({ state: 'completed' }),
      }),
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it('previews and submits only the persisted retry subset on later attempts', async () => {
    const adapter = provider();
    const validateExecution = vi.fn().mockResolvedValue('authorized');
    const authorize = vi.fn().mockResolvedValue('authorized');
    await dispatchIntegrationJob(
      { ...job, attemptNumber: 2, providerIdempotencyKey: `integration:${ids.job}:2` },
      {
        providers: { get: () => adapter },
        gateway: {
          validateExecution,
          authorize,
          complete: vi.fn().mockResolvedValue('completed'),
          fail: vi.fn(),
        },
      },
    );

    expect(adapter.previewRosterExport).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: `integration:${ids.job}:2` }),
      expect.objectContaining({
        roster: expect.objectContaining({ athletes: [expect.anything()] }),
      }),
    );
    expect(adapter.exportFinalizedRoster).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        previewId: 'preview:retry:000000001',
        confirmationToken: 'confirmation:retry:0001',
      }),
    );
    expect(validateExecution).toHaveBeenCalledTimes(3);
    expect(validateExecution.mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(adapter.previewRosterExport).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(adapter.previewRosterExport).mock.invocationCallOrder[0]).toBeLessThan(
      validateExecution.mock.invocationCallOrder[2]!,
    );
    expect(validateExecution.mock.invocationCallOrder[2]).toBeLessThan(
      authorize.mock.invocationCallOrder[0]!,
    );
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(adapter.exportFinalizedRoster).mock.invocationCallOrder[0]!,
    );
  });

  it('cancels without a provider handoff when execution-time authorization was revoked', async () => {
    const adapter = provider();
    const authorize = vi.fn();
    await expect(
      dispatchIntegrationJob(job, {
        providers: { get: () => adapter },
        gateway: {
          validateExecution: vi.fn().mockResolvedValue('authorization_revoked'),
          authorize,
          complete: vi.fn(),
          fail: vi.fn(),
        },
      }),
    ).resolves.toBe('cancelled');
    expect(adapter.verifyConnection).not.toHaveBeenCalled();
    expect(adapter.exportFinalizedRoster).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('reports delivery uncertainty when authorization is revoked during provider handoff', async () => {
    const adapter = provider();
    const complete = vi.fn();
    await expect(
      dispatchIntegrationJob(job, {
        providers: { get: () => adapter },
        gateway: {
          validateExecution: vi.fn().mockResolvedValue('authorized'),
          authorize: vi
            .fn()
            .mockResolvedValueOnce('authorized')
            .mockResolvedValueOnce('delivery_uncertain'),
          complete,
          fail: vi.fn(),
        },
      }),
    ).resolves.toBe('needs_attention');
    expect(adapter.exportFinalizedRoster).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it('rehydrates the disabled-by-default mock connection after process-local state is lost', async () => {
    const adapter = provider();
    vi.mocked(adapter.verifyConnection)
      .mockRejectedValueOnce({ code: 'authentication_required', retryable: false })
      .mockResolvedValueOnce({
        state: 'healthy',
        checkedAt: '2026-08-30T00:00:00.000Z',
        mockData: true,
      });
    vi.mocked(adapter.beginConnection).mockResolvedValue({
      mode: 'mock',
      challengeId: 'challenge:rehydrate:0001',
      expiresAt: '2099-01-01T00:00:00.000Z',
      displayLabel: 'The Squad (demo/mock — no live transfer)',
      mockData: true,
    });
    vi.mocked(adapter.completeConnection).mockResolvedValue({
      connectionId: ids.connection,
      providerKey: 'the-squad',
      state: 'connected',
      displayName: 'The Squad (demo/mock)',
      connectedAt: '2026-08-30T00:00:00.000Z',
      mockData: true,
    });
    await expect(
      dispatchIntegrationJob(job, {
        providers: { get: () => adapter },
        gateway: {
          validateExecution: vi.fn().mockResolvedValue('authorized'),
          authorize: vi.fn().mockResolvedValue('authorized'),
          complete: vi.fn().mockResolvedValue('completed'),
          fail: vi.fn(),
        },
      }),
    ).resolves.toBe('completed');
    expect(adapter.beginConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ids.organization,
        actorId: ids.actor,
        callbackUrl: expect.stringContaining('.invalid/'),
      }),
    );
    expect(adapter.completeConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ids.organization,
        actorId: ids.actor,
        callbackParameters: { mockApproval: 'approved' },
      }),
    );
  });
});
