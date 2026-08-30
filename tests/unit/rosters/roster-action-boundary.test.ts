import { describe, expect, it } from 'vitest';

import {
  bindChangeRosterActionInput,
  bindCreateRosterActionInput,
  bindFinalizeRosterActionInput,
  bindMoveRosterActionInput,
  bindReviseRosterActionInput,
} from '../../../src/modules/rosters/application/roster-action-boundary';

const scope = {
  organizationId: 'a1000000-0000-4000-8000-000000000001',
  tryoutId: 'a2000000-0000-4000-8000-000000000001',
  divisionId: 'a3000000-0000-4000-8000-000000000001',
};
const rosterVersionId = 'a4000000-0000-4000-8000-000000000001';
const registrationId = 'a5000000-0000-4000-8000-000000000001';
const teamId = 'a6000000-0000-4000-8000-000000000001';

describe('roster server-action boundaries', () => {
  it('rejects caller-owned scope and unknown own keys before binding a move command', () => {
    expect(
      bindMoveRosterActionInput(
        {
          rosterVersionId,
          registrationId,
          teamId,
          expectedVersion: 4,
          organizationId: 'f1000000-0000-4000-8000-000000000001',
          tryoutId: 'f2000000-0000-4000-8000-000000000001',
          divisionId: 'f3000000-0000-4000-8000-000000000001',
        },
        scope,
      ),
    ).toEqual({ ok: false });

    const poisoned = JSON.parse(
      `{"rosterVersionId":"${rosterVersionId}","registrationId":"${registrationId}","teamId":"${teamId}","expectedVersion":4,"__proto__":{"organizationId":"f1000000-0000-4000-8000-000000000001"}}`,
    );
    expect(bindMoveRosterActionInput(poisoned, scope)).toEqual({ ok: false });
  });

  it('constructs a new move command from exact fields and server-owned scope', () => {
    const inherited = Object.create({
      organizationId: 'f1000000-0000-4000-8000-000000000001',
      divisionId: 'f3000000-0000-4000-8000-000000000001',
    }) as Record<string, unknown>;
    Object.assign(inherited, { rosterVersionId, registrationId, teamId, expectedVersion: 4 });

    expect(bindMoveRosterActionInput(inherited, scope)).toEqual({ ok: false });
    expect(
      bindMoveRosterActionInput(
        { rosterVersionId, registrationId, teamId, expectedVersion: 4 },
        scope,
      ),
    ).toEqual({
      ok: true,
      data: { ...scope, rosterVersionId, registrationId, teamId, expectedVersion: 4 },
    });
  });

  it('applies exact runtime schemas to every roster action', () => {
    const cases = [
      () =>
        bindCreateRosterActionInput(
          { teams: [{ name: 'Blue', targetSize: 18, positionTargets: {} }], unexpected: true },
          scope,
        ),
      () =>
        bindChangeRosterActionInput(
          {
            rosterVersionId,
            expectedVersion: 4,
            changes: [{ registrationId, status: 'selected' }],
            unexpected: true,
          },
          scope,
        ),
      () =>
        bindFinalizeRosterActionInput(
          { rosterVersionId, expectedVersion: 4, unexpected: true },
          scope,
        ),
      () =>
        bindReviseRosterActionInput(
          {
            rosterVersionId,
            expectedVersion: 4,
            reason: 'Correcting a confirmed placement.',
            unexpected: true,
          },
          scope,
        ),
    ];

    for (const parse of cases) expect(parse()).toEqual({ ok: false });
  });
});
