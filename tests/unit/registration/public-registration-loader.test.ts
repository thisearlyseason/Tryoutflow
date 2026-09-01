// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../src/infrastructure/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.captureOperationalError,
}));

import { GET } from '../../../src/app/api/public/registrations/route';

function request(slug = 'fall-camp') {
  return new NextRequest(`https://tryoutflow.example/api/public/registrations?tryoutSlug=${slug}`);
}

const validConfiguration = {
  tryout_id: '11111111-1111-4111-8111-111111111111',
  name: 'Fall Camp',
  slug: 'fall-camp',
  form_schema: { fields: [] },
  divisions: [],
  positions: [],
};

describe('public registration configuration loader outcomes', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.captureOperationalError.mockReset();
  });

  it('keeps an actually absent or closed tryout non-oracular', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await GET(request('missing-camp'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      outcome: 'not_found',
      message: 'This registration is unavailable or closed.',
    });
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it('returns retryable unavailable without leaking an infrastructure error as a false 404', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error('database unavailable for guardian@example.test token=provider-secret'),
    });

    const response = await GET(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toBe(
      JSON.stringify({
        outcome: 'unavailable',
        message: 'Registration is temporarily unavailable. Please retry.',
      }),
    );
    expect(serialized).not.toMatch(/guardian|provider-secret|database/iu);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'registration.load',
    });
  });

  it('treats malformed upstream configuration as unavailable rather than absent', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          name: 'Fall Camp',
          slug: 'fall-camp',
          form_schema: { fields: 'malformed' },
          divisions: [],
          positions: [],
        },
      ],
      error: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      outcome: 'unavailable',
      message: 'Registration is temporarily unavailable. Please retry.',
    });
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a null outer result', null],
    ['a non-array outer result', validConfiguration],
    ['multiple rows for a unique slug', [validConfiguration, validConfiguration]],
  ])(
    'treats %s as unavailable rather than a false 404 or ambiguous success',
    async (_label, data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });

      const response = await GET(request());

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        outcome: 'unavailable',
        message: 'Registration is temporarily unavailable. Please retry.',
      });
      expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
    },
  );
});
