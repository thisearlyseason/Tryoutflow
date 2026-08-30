import { describe, expect, it } from 'vitest';

import { loadRosterWorkspace } from '../../../src/modules/rosters/application/load-roster-workspace';
import type { RosterWorkspaceData } from '../../../src/modules/rosters/application/roster-workspace';

const ids = {
  organization: 'b1000000-0000-4000-8000-000000000001',
  tryout: 'b2000000-0000-4000-8000-000000000001',
  division: 'b3000000-0000-4000-8000-000000000001',
  roster: 'b4000000-0000-4000-8000-000000000001',
  team: 'b5000000-0000-4000-8000-000000000001',
  registration: 'b6000000-0000-4000-8000-000000000001',
};
const input = {
  organizationId: ids.organization,
  tryoutId: ids.tryout,
  divisionId: ids.division,
  rosterVersionId: ids.roster,
};
const roster: RosterWorkspaceData = {
  rosterVersionId: ids.roster,
  state: 'draft',
  version: 1,
  revisionNumber: 1,
  basedOnRosterVersionId: null,
  revisionReason: null,
  finalizedAt: null,
  teams: [{ id: ids.team, name: 'Blue', targetSize: null, positionTargets: {} }],
  positions: [],
  members: [
    {
      registrationId: ids.registration,
      displayName: 'Snapshot Member',
      tryoutNumber: null,
      positionId: null,
      positionName: null,
      decision: 'undecided',
      teamId: null,
    },
  ],
};

describe('loadRosterWorkspace', () => {
  it('keeps authoritative roster data usable when ranking transport or parsing throws', async () => {
    await expect(
      loadRosterWorkspace(input, {
        rosters: { load: async () => ({ outcome: 'ok', snapshot: roster }) },
        rankings: { load: async () => Promise.reject(new Error('Invalid ranking projection')) },
      }),
    ).resolves.toEqual({
      outcome: 'ok',
      snapshot: roster,
      evidenceAvailability: 'unavailable',
      rankingRows: [],
    });
  });

  it('reports ranking authorization separately while retaining the roster', async () => {
    await expect(
      loadRosterWorkspace(input, {
        rosters: { load: async () => ({ outcome: 'ok', snapshot: roster }) },
        rankings: { load: async () => ({ outcome: 'forbidden' }) },
      }),
    ).resolves.toEqual({
      outcome: 'ok',
      snapshot: roster,
      evidenceAvailability: 'not_authorized',
      rankingRows: [],
    });
  });

  it('does not convert a roster authorization or transport failure into an empty roster', async () => {
    await expect(
      loadRosterWorkspace(input, {
        rosters: { load: async () => ({ outcome: 'forbidden' }) },
        rankings: { load: async () => ({ outcome: 'forbidden' }) },
      }),
    ).resolves.toEqual({ outcome: 'forbidden' });
    await expect(
      loadRosterWorkspace(input, {
        rosters: { load: async () => Promise.reject(new Error('transport')) },
        rankings: { load: async () => ({ outcome: 'forbidden' }) },
      }),
    ).resolves.toEqual({ outcome: 'unavailable' });
  });
});
