import { describe, expect, it, vi } from 'vitest';

import {
  mapCreateRosterResponse,
  mapReviseRosterResponse,
  SupabaseRosterGateway,
} from '../../../src/modules/rosters/infrastructure/supabase-roster-gateway';

const scope = {
  organizationId: 'c0000000-0000-4000-8000-000000000001',
  tryoutId: 'c0000000-0000-4000-8000-000000000002',
  divisionId: 'c0000000-0000-4000-8000-000000000003',
};
const rosterVersionId = 'c0000000-0000-4000-8000-000000000004';
const registrationId = 'c0000000-0000-4000-8000-000000000005';
const teamId = 'c0000000-0000-4000-8000-000000000006';

describe('SupabaseRosterGateway', () => {
  it('uses only guarded RPCs and forwards expected versions and confirmations exactly', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ outcome: 'created', roster_version_id: rosterVersionId, version: 1 }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [{ outcome: 'moved', version: 2 }], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: 'changed', version: 3 }], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: 'finalized', version: 4 }], error: null })
      .mockResolvedValueOnce({
        data: [{ outcome: 'revised', roster_version_id: rosterVersionId, version: 1 }],
        error: null,
      });
    const gateway = new SupabaseRosterGateway({ rpc } as never);

    await gateway.create({ ...scope, teams: [{ name: 'Blue' }] });
    await gateway.move({
      ...scope,
      rosterVersionId,
      registrationId,
      teamId,
      expectedVersion: 1,
    });
    await gateway.change({
      ...scope,
      rosterVersionId,
      changes: [{ registrationId, status: 'selected' }],
      expectedVersion: 2,
      confirmation: 'CONFIRM DECISIONS',
    });
    await gateway.finalize({
      ...scope,
      rosterVersionId,
      expectedVersion: 3,
      confirmation: 'FINALIZE ROSTER',
    });
    await gateway.revise({
      ...scope,
      rosterVersionId,
      expectedVersion: 4,
      reason: 'Correcting the final roster.',
      confirmation: 'REVISE ROSTER',
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'create_roster_draft',
      'move_roster_athlete',
      'change_roster_decisions',
      'finalize_roster_version',
      'revise_roster_version',
    ]);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'move_roster_athlete',
      expect.objectContaining({ p_expected_version: 1, p_team_id: teamId }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      4,
      'finalize_roster_version',
      expect.objectContaining({ p_confirmation: 'FINALIZE ROSTER', p_expected_version: 3 }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      5,
      'revise_roster_version',
      expect.objectContaining({ p_expected_version: 4 }),
    );
  });

  it('fails closed on malformed, unknown, or incomplete RPC results', () => {
    expect(mapCreateRosterResponse([{ outcome: 'created', version: 1 }], null)).toEqual({
      outcome: 'unexpected',
    });
    expect(
      mapReviseRosterResponse(
        [{ outcome: 'revised', roster_version_id: rosterVersionId, version: null }],
        null,
      ),
    ).toEqual({ outcome: 'unexpected' });
    expect(mapCreateRosterResponse([{ outcome: 'invented', version: 1 }], null)).toEqual({
      outcome: 'unexpected',
    });
    expect(
      mapReviseRosterResponse([{ outcome: 'conflict', roster_version_id: null, version: 7 }], null),
    ).toEqual({ outcome: 'conflict', version: 7 });
    expect(
      mapReviseRosterResponse(
        [{ outcome: 'conflict', roster_version_id: null, version: null }],
        null,
      ),
    ).toEqual({ outcome: 'unexpected' });
  });
});
