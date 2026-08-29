import { describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { changeDecision } from '../../../src/modules/rosters/application/change-decision';
import { createRosterDraft } from '../../../src/modules/rosters/application/create-roster-draft';
import { finalizeRoster } from '../../../src/modules/rosters/application/finalize-roster';
import { moveAthlete } from '../../../src/modules/rosters/application/move-athlete';
import { reviseRoster } from '../../../src/modules/rosters/application/revise-roster';
import {
  FINALIZE_ROSTER_CONFIRMATION,
  REVISE_ROSTER_CONFIRMATION,
  transitionRoster,
} from '../../../src/modules/rosters/domain/roster';

const ids = {
  organization: 'a0000000-0000-4000-8000-000000000001',
  tryout: 'a0000000-0000-4000-8000-000000000002',
  division: 'a0000000-0000-4000-8000-000000000003',
  roster: 'a0000000-0000-4000-8000-000000000004',
  registration: 'a0000000-0000-4000-8000-000000000005',
  team: 'a0000000-0000-4000-8000-000000000006',
  actor: 'a0000000-0000-4000-8000-000000000007',
};

function director(divisionId = ids.division): AuthorizationContext {
  return {
    userId: ids.actor as AuthorizationContext['userId'],
    organizationId: ids.organization as AuthorizationContext['organizationId'],
    organizationRole: 'member',
    membershipStatus: 'active',
    assignments: [
      {
        role: 'director',
        scope: { kind: 'division', tryoutId: ids.tryout, divisionId },
      },
    ],
  };
}

describe('roster lifecycle', () => {
  it('allows only explicit finalization and revision transitions', () => {
    expect(transitionRoster('draft', 'finalize')).toBe('finalized');
    expect(transitionRoster('finalized', 'revise')).toBe('draft');
    expect(() => transitionRoster('finalized', 'finalize')).toThrow('invalid roster transition');
  });

  it('rejects a move from an actor outside the exact division before persistence', async () => {
    const move = vi.fn();
    await expect(
      moveAthlete(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          registrationId: ids.registration,
          teamId: ids.team,
          expectedVersion: 1,
        },
        director('a0000000-0000-4000-8000-000000000099'),
        { gateway: { move } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(move).not.toHaveBeenCalled();
  });

  it('keeps decision changes independent from placement commands', async () => {
    const change = vi.fn().mockResolvedValue({ outcome: 'changed', version: 3 });
    await expect(
      changeDecision(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          expectedVersion: 2,
          confirmation: 'CONFIRM DECISIONS',
          changes: [{ registrationId: ids.registration, status: 'waitlisted' }],
        },
        director(),
        { gateway: { change } },
      ),
    ).resolves.toEqual({ ok: true, value: { version: 3 } });
    expect(change).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ registrationId: ids.registration, status: 'waitlisted' }],
      }),
    );
  });

  it('requires exact explicit confirmation before finalization', async () => {
    const finalize = vi.fn();
    await expect(
      finalizeRoster(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          expectedVersion: 2,
          confirmation: 'yes',
        },
        director(),
        { gateway: { finalize } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'confirmation_required' } });
    await expect(
      finalizeRoster(
        {
          organizationId: 'not-a-uuid',
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          expectedVersion: 2,
          confirmation: FINALIZE_ROSTER_CONFIRMATION,
        },
        director(),
        { gateway: { finalize } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_roster' } });
    await expect(
      changeDecision(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          expectedVersion: 2,
          confirmation: 'CONFIRM DECISIONS',
          changes: [
            { registrationId: ids.registration, status: 'released' },
            { registrationId: ids.registration, status: 'selected' },
          ],
        },
        director(),
        { gateway: { change: vi.fn() } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_decisions' } });
    expect(finalize).not.toHaveBeenCalled();

    finalize.mockResolvedValue({ outcome: 'finalized', version: 3 });
    await expect(
      finalizeRoster(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          expectedVersion: 2,
          confirmation: FINALIZE_ROSTER_CONFIRMATION,
        },
        director(),
        { gateway: { finalize } },
      ),
    ).resolves.toEqual({ ok: true, value: { state: 'finalized', version: 3 } });
  });

  it('requires a bounded reason and explicit confirmation to revise', async () => {
    const revise = vi.fn();
    await expect(
      reviseRoster(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          reason: 'short',
          confirmation: REVISE_ROSTER_CONFIRMATION,
        },
        director(),
        { gateway: { revise } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_reason' } });
    await expect(
      reviseRoster(
        {
          organizationId: 'not-a-uuid',
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          reason: 'A sufficiently detailed correction reason.',
          confirmation: REVISE_ROSTER_CONFIRMATION,
        },
        director(),
        { gateway: { revise } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_roster' } });
    expect(revise).not.toHaveBeenCalled();
  });

  it('maps malformed teams and wrong confirmations to their exact validation outcomes', async () => {
    await expect(
      createRosterDraft(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          teams: [{ name: 'Blue' }, { name: 'blue' }],
        },
        director(),
        { gateway: { create: vi.fn() } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_teams' } });
    await expect(
      changeDecision(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          expectedVersion: 2,
          confirmation: 'yes',
          changes: [{ registrationId: ids.registration, status: 'released' }],
        },
        director(),
        { gateway: { change: vi.fn() } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'confirmation_required' } });
    await expect(
      reviseRoster(
        {
          organizationId: ids.organization,
          tryoutId: ids.tryout,
          divisionId: ids.division,
          rosterVersionId: ids.roster,
          reason: 'A sufficiently detailed correction reason.',
          confirmation: 'yes',
        },
        director(),
        { gateway: { revise: vi.fn() } },
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'confirmation_required' } });
  });
});
