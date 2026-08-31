import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerSupabaseClient, from, maybeSingle, rpc } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const query = {
    eq: vi.fn(),
    maybeSingle,
    select: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  const from = vi.fn(() => query);
  const rpc = vi.fn();
  return {
    createServerSupabaseClient: vi.fn(async () => ({ from, rpc })),
    from,
    maybeSingle,
    rpc,
  };
});

vi.mock('../../../src/infrastructure/supabase/server', () => ({ createServerSupabaseClient }));

import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { saveWizardConfiguration } from '../../../src/modules/tryouts/application/save-wizard-configuration';

const organizationId = '10000000-0000-4000-8000-000000000001';
const tryoutId = '10000000-0000-4000-8000-000000000002';
const actor: { authorization: AuthorizationContext } = {
  authorization: {
    userId: '10000000-0000-4000-8000-000000000003' as AuthorizationContext['userId'],
    organizationId: organizationId as AuthorizationContext['organizationId'],
    organizationRole: 'owner',
    membershipStatus: 'active',
    assignments: [],
  },
};

describe('saveWizardConfiguration local-time boundary', () => {
  beforeEach(() => {
    from.mockClear();
    maybeSingle.mockReset();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [{ outcome: 'saved' }], error: null });
  });

  it('converts Edmonton registration wall times to canonical UTC before the RPC', async () => {
    const result = await saveWizardConfiguration(
      {
        organizationId,
        tryoutId,
        step: 'basics',
        payload: {
          name: 'Fall ID Camp',
          sport: 'Hockey',
          timezone: 'America/Edmonton',
          registrationStartsAt: '2026-09-01T08:00',
          registrationEndsAt: '2026-09-30T20:00',
        },
      },
      actor,
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(rpc).toHaveBeenCalledWith('save_tryout_wizard_configuration', {
      p_organization_id: organizationId,
      p_tryout_id: tryoutId,
      p_step: 'basics',
      p_payload: {
        name: 'Fall ID Camp',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
        registrationStartsAt: '2026-09-01T14:00:00.000Z',
        registrationEndsAt: '2026-10-01T02:00:00.000Z',
      },
    });
  });

  it('loads the selected tryout timezone and converts session wall times before the RPC', async () => {
    maybeSingle.mockResolvedValue({ data: { timezone: 'America/Edmonton' }, error: null });

    const result = await saveWizardConfiguration(
      {
        organizationId,
        tryoutId,
        step: 'sessions',
        payload: {
          divisionId: '10000000-0000-4000-8000-000000000004',
          name: 'Skills session',
          startsAt: '2026-10-01T16:00',
          endsAt: '2026-10-01T18:00',
          groupName: '',
          positionName: 'Forward',
        },
      },
      actor,
    );

    expect(result).toEqual({ ok: true, value: undefined });
    expect(from).toHaveBeenCalledWith('tryouts');
    expect(rpc).toHaveBeenCalledWith('save_tryout_wizard_configuration', {
      p_organization_id: organizationId,
      p_tryout_id: tryoutId,
      p_step: 'sessions',
      p_payload: {
        divisionId: '10000000-0000-4000-8000-000000000004',
        name: 'Skills session',
        startsAt: '2026-10-01T22:00:00.000Z',
        endsAt: '2026-10-02T00:00:00.000Z',
        groupName: '',
        positionName: 'Forward',
      },
    });
  });

  it('rejects a nonexistent Edmonton wall time without calling the RPC', async () => {
    const result = await saveWizardConfiguration(
      {
        organizationId,
        tryoutId,
        step: 'basics',
        payload: {
          name: 'Spring ID Camp',
          sport: 'Hockey',
          timezone: 'America/Edmonton',
          registrationStartsAt: '2026-03-08T02:30',
          registrationEndsAt: '2026-03-08T04:30',
        },
      },
      actor,
    );

    expect(result).toEqual({ ok: false, error: { code: 'invalid_input' } });
    expect(rpc).not.toHaveBeenCalled();
  });
});
