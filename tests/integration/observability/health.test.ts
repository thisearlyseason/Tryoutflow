// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  handleHealthRequest,
  type HealthGateway,
} from '../../../src/modules/observability/application/health-check';

const detailedHealth = {
  database: 'ok' as const,
  failedJobs: 2,
  webhookFailures: 1,
  communicationFailures: 1,
  integrationFailures: 0,
  synchronizationProblems: 3,
};

function gateway(input: Partial<HealthGateway> = {}): HealthGateway {
  return {
    readCoarse: async () => 'ok',
    readDetailed: async () => null,
    ...input,
  };
}

describe('health boundary', () => {
  it('returns a coarse, non-cacheable public response without component or tenant details', async () => {
    const response = await handleHealthRequest(gateway());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });

  it('returns allow-listed operational aggregates only when the gateway authorizes detail', async () => {
    const response = await handleHealthRequest(
      gateway({ readDetailed: async () => detailedHealth }),
    );

    expect(await response.json()).toEqual({ status: 'ok', details: detailedHealth });
    const publicResponse = await handleHealthRequest(gateway());
    expect(JSON.stringify(await publicResponse.json())).not.toContain('organization');
  });

  it('does not turn a detailed-health denial into an authorization oracle', async () => {
    const response = await handleHealthRequest(
      gateway({
        readDetailed: async () => {
          throw new Error('permission denied for platform role');
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports only coarse degradation when database connectivity fails', async () => {
    const response = await handleHealthRequest(
      gateway({
        readCoarse: async () => {
          throw new Error('postgres host and password must remain private');
        },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'degraded' });
  });
});
