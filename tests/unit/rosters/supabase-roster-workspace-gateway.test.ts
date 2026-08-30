import { describe, expect, it, vi } from 'vitest';

import {
  parseRosterWorkspaceResponse,
  SupabaseRosterWorkspaceGateway,
} from '../../../src/modules/rosters/infrastructure/supabase-roster-workspace-gateway';

const ids = {
  organization: 'd0000000-0000-4000-8000-000000000001',
  tryout: 'd0000000-0000-4000-8000-000000000002',
  division: 'd0000000-0000-4000-8000-000000000003',
  roster: 'd0000000-0000-4000-8000-000000000004',
  team: 'd0000000-0000-4000-8000-000000000005',
  position: 'd0000000-0000-4000-8000-000000000006',
  registration: 'd0000000-0000-4000-8000-000000000007',
};

const payload = {
  outcome: 'ok',
  snapshot: {
    rosterVersionId: ids.roster,
    state: 'draft',
    version: 4,
    revisionNumber: 1,
    basedOnRosterVersionId: null,
    revisionReason: null,
    finalizedAt: null,
    teams: [
      {
        id: ids.team,
        name: 'Blue',
        targetSize: 18,
        positionTargets: { [ids.position]: 10 },
      },
    ],
    positions: [{ id: ids.position, name: 'Forward' }],
    members: [
      {
        registrationId: ids.registration,
        displayName: 'Ava One',
        tryoutNumber: 42,
        positionId: ids.position,
        positionName: 'Forward',
        decision: 'undecided',
        teamId: null,
      },
    ],
  },
};

describe('SupabaseRosterWorkspaceGateway', () => {
  it('loads the exact roster through the bounded workspace RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ result: payload }], error: null });
    const gateway = new SupabaseRosterWorkspaceGateway({ rpc } as never);

    await expect(
      gateway.load({
        organizationId: ids.organization,
        tryoutId: ids.tryout,
        divisionId: ids.division,
        rosterVersionId: ids.roster,
      }),
    ).resolves.toEqual(payload);
    expect(rpc).toHaveBeenCalledWith('load_roster_workspace', {
      p_organization_id: ids.organization,
      p_tryout_id: ids.tryout,
      p_division_id: ids.division,
      p_roster_version_id: ids.roster,
    });
  });

  it.each([
    ['leading and trailing whitespace', '  Ana María  '],
    ['significant internal whitespace', 'Ana  María'],
    ['Turkish dotted I', 'İPEK'],
    ['NFC text', 'Élodie'],
    ['NFD text', 'E\u0301lodie'],
    ['mixed case', 'McKay'],
  ])('preserves the RPC %s display label byte-for-byte', async (_, displayName) => {
    const exactPayload = {
      ...payload,
      snapshot: {
        ...payload.snapshot,
        members: [{ ...payload.snapshot.members[0], displayName }],
      },
    };
    const rpc = vi.fn().mockResolvedValue({ data: [{ result: exactPayload }], error: null });
    const gateway = new SupabaseRosterWorkspaceGateway({ rpc } as never);

    const result = await gateway.load({
      organizationId: ids.organization,
      tryoutId: ids.tryout,
      divisionId: ids.division,
      rosterVersionId: ids.roster,
    });

    expect(result).toEqual(exactPayload);
    if (result.outcome !== 'ok') throw new Error('expected an authorized workspace');
    expect(result.snapshot.members[0]?.displayName).toBe(displayName);
  });

  it('rejects blank or overlong RPC display labels without repairing them', () => {
    for (const displayName of [' \t ', 'A'.repeat(242)]) {
      expect(() =>
        parseRosterWorkspaceResponse({
          ...payload,
          snapshot: {
            ...payload.snapshot,
            members: [{ ...payload.snapshot.members[0], displayName }],
          },
        }),
      ).toThrow(/roster workspace projection/i);
    }
  });

  it('fails closed on malformed identity, placement, or decision data', () => {
    expect(() =>
      parseRosterWorkspaceResponse({
        ...payload,
        snapshot: {
          ...payload.snapshot,
          members: [{ ...payload.snapshot.members[0], decision: 'invented' }],
        },
      }),
    ).toThrow(/roster workspace projection/i);
    expect(() =>
      parseRosterWorkspaceResponse({
        ...payload,
        snapshot: {
          ...payload.snapshot,
          members: [{ ...payload.snapshot.members[0], teamId: 'foreign' }],
        },
      }),
    ).toThrow(/roster workspace projection/i);
  });

  it('preserves explicit authorization outcomes without accepting a snapshot', () => {
    expect(parseRosterWorkspaceResponse({ outcome: 'forbidden' })).toEqual({
      outcome: 'forbidden',
    });
    expect(parseRosterWorkspaceResponse({ outcome: 'invalid_scope' })).toEqual({
      outcome: 'invalid_scope',
    });
    expect(() => parseRosterWorkspaceResponse({ outcome: 'forbidden', snapshot: {} })).toThrow(
      /roster workspace projection/i,
    );
  });
});
