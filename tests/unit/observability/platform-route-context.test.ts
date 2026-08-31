// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../src/modules/observability/domain/app-error';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  health: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('../../../src/infrastructure/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock(
  '../../../src/modules/observability/infrastructure/supabase-platform-administration-gateway',
  () => ({
    SupabasePlatformAdministrationGateway: class {
      health() {
        return mocks.health();
      }
    },
  }),
);

import { requirePlatformRouteContext } from '../../../src/modules/observability/application/platform-route-context';

describe('platform route context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'platform-user' } } });
  });

  it('maps current platform authorization denial to the non-oracular not-found boundary', async () => {
    mocks.health.mockRejectedValue(
      new AppError({
        category: 'permission',
        code: 'platform_forbidden',
        message: 'Platform authorization required.',
      }),
    );

    await expect(requirePlatformRouteContext()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('lets an operational failure reach the generic platform error boundary', async () => {
    mocks.health.mockRejectedValue(
      new AppError({
        category: 'unexpected',
        code: 'platform_unavailable',
        message: 'Platform administration is unavailable.',
      }),
    );

    await expect(requirePlatformRouteContext()).rejects.toMatchObject({
      category: 'unexpected',
      code: 'platform_unavailable',
    });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
