// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  claimIntegrationJobs,
  SupabaseIntegrationDispatchGateway,
} from '../../../src/infrastructure/integrations/integration-outbox';

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('integration outbox gateway', () => {
  it('strictly parses claimed work and rejects incomplete lease projections', async () => {
    const row = {
      outbox_job_id: id('1'),
      sync_job_id: id('2'),
      organization_id: id('3'),
      connection_id: id('4'),
      provider_key: 'the-squad',
      actor_user_id: id('5'),
      lease_token: id('6'),
      lease_generation: 1,
      lease_expires_at: '2099-01-01T00:00:00.000Z',
      provider_idempotency_key: `integration:${id('2')}:1`,
      attempt_number: 1,
      item_keys: [`athlete:${id('7')}`],
      confirmed_request: {
        destination: {
          organization: {
            providerKey: 'the-squad',
            entityType: 'organization',
            externalId: 'mock-org',
            displayName: 'Mock org',
            mockData: true,
          },
          season: {
            providerKey: 'the-squad',
            entityType: 'season',
            externalId: 'mock-season',
            displayName: 'Mock season',
            mockData: true,
          },
          division: {
            providerKey: 'the-squad',
            entityType: 'division',
            externalId: 'mock-division',
            displayName: 'Mock division',
            mockData: true,
          },
          team: {
            providerKey: 'the-squad',
            entityType: 'team',
            externalId: 'mock-team',
            displayName: 'Mock team',
            mockData: true,
          },
          displayLabel: 'Mock destination',
          mockData: true,
        },
        approvedFields: ['first_name'],
        roster: {
          organizationId: id('3'),
          tryoutId: id('8'),
          divisionId: id('9'),
          rosterVersionId: id('10'),
          version: 2,
          state: 'finalized',
          finalizedAt: '2026-08-30T00:00:00.000Z',
          teams: [{ id: id('11'), name: 'Blue' }],
          athletes: [
            {
              registrationId: id('7'),
              firstName: 'Synthetic',
              lastName: 'Athlete',
              teamId: id('11'),
            },
          ],
        },
        previewId: 'preview:task27:00000001',
        confirmationToken: 'confirmation:task27:00000001',
      },
    };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });

    await expect(
      claimIntegrationJobs({ rpc } as never, {
        leaseOwner: 'worker-task27',
        batchSize: 5,
        leaseSeconds: 90,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ outboxJobId: id('1'), leaseGeneration: 1, attemptNumber: 1 }),
    ]);

    rpc.mockResolvedValueOnce({ data: [{ ...row, lease_token: null }], error: null });
    await expect(
      claimIntegrationJobs({ rpc } as never, {
        leaseOwner: 'worker-task27',
        batchSize: 5,
        leaseSeconds: 90,
      }),
    ).rejects.toThrow('Invalid claimed integration job');
  });

  it('maps fenced authorize, completion, and failure results', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 'authorized', error: null })
      .mockResolvedValueOnce({ data: 'completed', error: null })
      .mockResolvedValueOnce({ data: 'retry_scheduled', error: null });
    const gateway = new SupabaseIntegrationDispatchGateway({ rpc } as never);
    const lease = { outboxJobId: id('1'), leaseToken: id('6'), leaseGeneration: 2 };

    await expect(gateway.authorize(lease)).resolves.toBe('authorized');
    await expect(
      gateway.complete({
        ...lease,
        externalJobId: 'mock-job',
        result: { externalJobId: 'mock-job', state: 'completed', items: [], mockData: true },
      }),
    ).resolves.toBe('completed');
    await expect(
      gateway.fail({ ...lease, errorCode: 'provider_temporary', retryable: true }),
    ).resolves.toBe('retry_scheduled');
  });
});
