import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), context: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../../../src/modules/organizations/application/organization-route-context', () => ({
  requireOrganizationRouteContext: mocks.context,
}));
import { completeSingleTryoutAction } from '../../../src/modules/tryouts/application/complete-single-tryout-action';
const org = 'e1570000-0000-4000-8000-000000000010';
const event = 'e1570000-0000-4000-8000-000000000020';
const context = (role = 'owner') => ({
  organization: { id: org },
  client: { rpc: mocks.rpc },
  authorization: {
    organizationId: org,
    userId: 'owner',
    organizationRole: role,
    membershipStatus: 'active',
    assignments: [],
  },
});
const confirmation = () => {
  const form = new FormData();
  form.set('confirm', 'yes');
  return form;
};

describe('complete a single-use event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue(context());
  });
  it('requires explicit acknowledgement before an irreversible lock', async () => {
    expect(await completeSingleTryoutAction('club', event, 4, null, new FormData())).toHaveProperty(
      'error',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rechecks membership before completion', async () => {
    mocks.context.mockResolvedValue(context('member'));
    expect(await completeSingleTryoutAction('club', event, 4, null, confirmation())).toHaveProperty(
      'error',
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { data: 'conflict', error: null },
    { data: null, error: { code: '42501' } },
  ])('does not report completion on a stale or forbidden request', async (result) => {
    mocks.rpc.mockResolvedValue(result);
    expect(await completeSingleTryoutAction('club', event, 4, null, confirmation())).toHaveProperty(
      'error',
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('refreshes event screens only after the database confirms completion', async () => {
    mocks.rpc.mockResolvedValue({ data: 'completed', error: null });
    expect(await completeSingleTryoutAction('club', event, 4, null, confirmation())).toEqual({
      completed: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('complete_single_tryout', {
      p_organization_id: org,
      p_tryout_id: event,
      p_expected_version: 4,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/club/tryouts', 'layout');
  });
});
