import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, requireOrganizationRouteContext, captureOperationalError, redirect, revalidatePath } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    requireOrganizationRouteContext: vi.fn(),
    captureOperationalError: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
    revalidatePath: vi.fn(),
  }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('../../../src/modules/organizations/application/organization-route-context', () => ({
  requireOrganizationRouteContext,
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError,
}));

import { duplicateTryoutAction } from '../../../src/modules/tryouts/application/duplicate-tryout-action';

const organizationId = 'f1130000-0000-4000-8000-000000000010';
const sourceTryoutId = 'f1130000-0000-4000-8000-000000000020';
function context(role = 'owner') {
  return {
    organization: { id: organizationId },
    userId: 'actor',
    client: { rpc },
    authorization: {
      organizationId,
      userId: 'actor',
      organizationRole: role,
      membershipStatus: 'active',
      assignments: [],
    },
  };
}

describe('duplicate tryout action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOrganizationRouteContext.mockResolvedValue(context());
  });
  it('reauthorizes and redirects directly to the complete copied draft', async () => {
    rpc.mockResolvedValue({ data: [{ tryout_id: 'new-draft', slug: 'new-slug' }], error: null });
    await expect(duplicateTryoutAction('club', sourceTryoutId, null)).rejects.toThrow(
      'redirect:/app/club/tryouts/new-draft/setup/basics',
    );
    expect(requireOrganizationRouteContext).toHaveBeenCalledWith('club');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('duplicate_tryout', {
      p_organization_id: organizationId,
      p_source_tryout_id: sourceTryoutId,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/app/club/tryouts');
  });
  it('rejects a revoked management capability before calling the database', async () => {
    requireOrganizationRouteContext.mockResolvedValue(context('member'));
    expect(await duplicateTryoutAction('club', sourceTryoutId, null)).toEqual({
      error: 'You no longer have permission to duplicate this tryout.',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: { code: '42501', message: 'forbidden' } },
    { data: [], error: null },
  ])('reports clone failure without any incomplete fallback (%j)', async (result) => {
    rpc.mockResolvedValue(result);
    expect(await duplicateTryoutAction('club', sourceTryoutId, null)).toEqual({
      error: expect.stringContaining('could not be duplicated'),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(captureOperationalError).toHaveBeenCalledTimes(1);
  });
});
