import { describe, expect, it, vi } from 'vitest';

const createServerSupabaseClient = vi.hoisted(() => vi.fn());

vi.mock('../../../src/infrastructure/supabase/server', () => ({ createServerSupabaseClient }));

import { GET } from '../../../src/app/api/health/route';

describe('GET /api/health', () => {
  it('maps an unauthorized caller to the same coarse response as anonymous health', async () => {
    createServerSupabaseClient.mockResolvedValue({
      rpc: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ status: 'ok' }], error: null })
        .mockResolvedValueOnce({ data: null, error: { code: '42501' } }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('maps the authorized database projection to privacy-safe aggregate names', async () => {
    createServerSupabaseClient.mockResolvedValue({
      rpc: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ status: 'ok' }], error: null })
        .mockResolvedValueOnce({
          data: [
            {
              database_status: 'ok',
              failed_jobs: 3,
              webhook_failures: 2,
              communication_failures: 1,
              integration_failures: 1,
              synchronization_problems: 4,
            },
          ],
          error: null,
        }),
    });

    const response = await GET();

    expect(await response.json()).toEqual({
      status: 'ok',
      details: {
        database: 'ok',
        failedJobs: 3,
        webhookFailures: 2,
        communicationFailures: 1,
        integrationFailures: 1,
        synchronizationProblems: 4,
      },
    });
  });
});
