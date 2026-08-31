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
    mocks.health.mockRejectedValue(new AppError('platform_forbidden'));

    await expect(requirePlatformRouteContext()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('lets an operational failure reach the generic platform error boundary', async () => {
    mocks.health.mockRejectedValue(new AppError('platform_unavailable'));

    await expect(requirePlatformRouteContext()).rejects.toMatchObject({
      category: 'unexpected',
      code: 'platform_unavailable',
    });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('derives platform denial from a single closed code snapshot instead of mutable category', async () => {
    const error = new AppError('platform_forbidden');
    let categoryReads = 0;
    Object.defineProperty(error, 'category', {
      configurable: true,
      get: () => {
        categoryReads += 1;
        return 'unexpected';
      },
    });
    mocks.health.mockRejectedValue(error);

    await expect(requirePlatformRouteContext()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(categoryReads).toBe(0);
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('normalizes a throwing platform error accessor without exposing its message', async () => {
    const error = new AppError('platform_unavailable');
    Object.defineProperty(error, 'category', {
      configurable: true,
      get: () => {
        throw new Error('sk_private private@example.com score_98');
      },
    });
    mocks.health.mockRejectedValue(error);

    let received: unknown;
    try {
      await requirePlatformRouteContext();
    } catch (caught) {
      received = caught;
    }
    expect(received).toMatchObject({
      category: 'unexpected',
      code: 'platform_unavailable',
      message: 'Platform administration is unavailable.',
    });
    expect(JSON.stringify(received)).not.toMatch(/sk_private|private@example\.com|score_98/u);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
