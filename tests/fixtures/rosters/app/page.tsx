'use client';

import {
  RosterBuilder,
  type RosterBuilderProps,
  type RosterWorkspaceSnapshot,
} from '../../../../src/modules/rosters/ui/roster-builder';

export const rosterFixture: RosterWorkspaceSnapshot = {
  rosterVersionId: '10000000-0000-4000-8000-000000000001',
  state: 'draft',
  version: 4,
  revisionNumber: 1,
  basedOnRosterVersionId: null,
  revisionReason: null,
  finalizedAt: null,
  evidenceAvailability: 'available',
  positions: [
    { id: '10000000-0000-4000-8000-000000000002', name: 'Forward' },
    { id: '10000000-0000-4000-8000-000000000003', name: 'Goalie' },
  ],
  teams: [
    {
      id: '10000000-0000-4000-8000-000000000004',
      name: 'Blue',
      targetSize: 2,
      positionTargets: { '10000000-0000-4000-8000-000000000002': 1 },
    },
    {
      id: '10000000-0000-4000-8000-000000000005',
      name: 'White',
      targetSize: 1,
      positionTargets: {},
    },
  ],
  athletes: [
    {
      registrationId: '10000000-0000-4000-8000-000000000006',
      displayName: 'Athlete 42',
      tryoutNumber: 42,
      positionId: '10000000-0000-4000-8000-000000000002',
      positionName: 'Forward',
      rankingEvidence: {
        status: 'available',
        overall: '88.5',
        completedEvaluators: 3,
        expectedEvaluators: 3,
        scoreRange: ['86.0', '91.0'],
        flags: ['needs_another_look'],
      },
      decision: 'undecided',
      teamId: null,
    },
    {
      registrationId: '10000000-0000-4000-8000-000000000007',
      displayName: 'Athlete 7',
      tryoutNumber: 7,
      positionId: '10000000-0000-4000-8000-000000000003',
      positionName: 'Goalie',
      rankingEvidence: {
        status: 'available',
        overall: '80.0',
        completedEvaluators: 2,
        expectedEvaluators: 3,
        scoreRange: ['78.0', '82.0'],
        flags: [],
      },
      decision: 'waitlisted',
      teamId: '10000000-0000-4000-8000-000000000004',
    },
  ],
};

const actions: Pick<
  RosterBuilderProps,
  'onMove' | 'onChangeDecisions' | 'onFinalize' | 'onRevise'
> = {
  onMove: async ({ expectedVersion }) => ({ ok: true, version: expectedVersion + 1 }),
  onChangeDecisions: async ({ expectedVersion }) => ({ ok: true, version: expectedVersion + 1 }),
  onFinalize: async ({ expectedVersion }) => ({ ok: true, version: expectedVersion + 1 }),
  onRevise: async () => ({
    ok: true,
    rosterVersionId: '10000000-0000-4000-8000-000000000099',
    version: 1,
  }),
};

export default function Page() {
  return (
    <>
      <h1 className="mb-4">Accessible roster workspace</h1>
      <h2 className="sr-only">Roster builder</h2>
      <RosterBuilder canEdit initial={rosterFixture} {...actions} />
    </>
  );
}
