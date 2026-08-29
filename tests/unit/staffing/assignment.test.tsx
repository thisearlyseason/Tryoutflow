import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { assignEvaluator } from '../../../src/modules/staffing/application/assign-evaluator';
import { listAssignedAthletes } from '../../../src/modules/staffing/application/list-assigned-athletes';
import {
  resolveAssignedRegistrations,
  type EvaluationScope,
} from '../../../src/modules/staffing/domain/assignment';
import { AssignmentWorkspace } from '../../../src/modules/staffing/ui/assignment-workspace';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const actorId = '11111111-1111-4111-8111-111111111111' as UserId;
const evaluatorId = '22222222-2222-4222-8222-222222222222' as UserId;
const tryoutId = '33333333-3333-4333-8333-333333333333';
const divisionId = '44444444-4444-4444-8444-444444444444';
const sessionId = '55555555-5555-4555-8555-555555555555';
const groupId = '66666666-6666-4666-8666-666666666666';

const owner: AuthorizationContext = {
  userId: actorId,
  organizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

describe('evaluator assignment scopes', () => {
  it('resolves only registrations in the exact group assignment', () => {
    const scope: EvaluationScope = { kind: 'group', tryoutId, sessionId, groupId };
    const registrations = [
      { registrationId: 'a', tryoutId, divisionId, sessionId, groupId },
      { registrationId: 'b', tryoutId, divisionId, sessionId, groupId: 'other' },
      { registrationId: 'c', tryoutId, divisionId, sessionId: 'other', groupId },
    ];

    expect(resolveAssignedRegistrations(scope, registrations)).toEqual(['a']);
  });

  it('rejects a scope with mismatched tenant relationships at the gateway boundary', async () => {
    const result = await assignEvaluator(
      {
        organizationId,
        evaluatorUserId: evaluatorId,
        scope: { kind: 'session', tryoutId, sessionId },
      },
      owner,
      { assign: async () => ({ outcome: 'invalid_scope' }) },
    );

    expect(result).toEqual({ ok: false, error: { code: 'invalid_scope' } });
  });

  it('maps duplicate active grants to a conflict and permits a revoked scope to be regranted', async () => {
    const outcomes = ['duplicate', 'assigned'] as const;
    let call = 0;
    const gateway = { assign: async () => ({ outcome: outcomes[call++]! }) };
    const input = {
      organizationId,
      evaluatorUserId: evaluatorId,
      scope: { kind: 'division' as const, tryoutId, divisionId },
    };

    await expect(assignEvaluator(input, owner, gateway)).resolves.toEqual({
      ok: false,
      error: { code: 'conflict' },
    });
    await expect(assignEvaluator(input, owner, gateway)).resolves.toMatchObject({ ok: true });
  });
});

describe('assigned athlete projection', () => {
  it('returns forbidden for an unassigned evaluator without calling the repository', async () => {
    let called = false;
    const evaluator: AuthorizationContext = {
      ...owner,
      userId: evaluatorId,
      organizationRole: 'member',
    };

    await expect(
      listAssignedAthletes({ organizationId, tryoutId }, evaluator, {
        list: async () => {
          called = true;
          return [];
        },
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(called).toBe(false);
  });

  it('passes only actor and scope keys to a repository that returns blind-safe rows', async () => {
    const evaluator: AuthorizationContext = {
      ...owner,
      userId: evaluatorId,
      organizationRole: 'member',
      assignments: [{ role: 'evaluator', scope: { kind: 'tryout', tryoutId } }],
    };
    let received: unknown;

    const result = await listAssignedAthletes({ organizationId, tryoutId }, evaluator, {
      list: async (input) => {
        received = input;
        return [
          {
            registrationId: '77777777-7777-4777-8777-777777777777',
            displayName: 'Athlete 0042',
            divisionName: 'U13',
            sessionName: 'Skills',
            groupName: null,
            tryoutNumber: 42,
            identityMode: 'blind',
          },
        ];
      },
    });

    expect(received).toEqual({ organizationId, tryoutId, evaluatorUserId: evaluatorId });
    expect(result).toMatchObject({ ok: true, value: [{ displayName: 'Athlete 0042' }] });
    expect(JSON.stringify(result)).not.toMatch(/guardian|birth|email|phone|score|rank|note/iu);
  });
});

describe('assignment workspace', () => {
  it('keeps staffing controls labelled and touch-sized at narrow widths', () => {
    render(
      <AssignmentWorkspace
        evaluators={[{ userId: evaluatorId, displayName: 'Evan Evaluator' }]}
        onAssign={async () => ({ outcome: 'assigned' })}
        onInvite={async () => ({ outcome: 'invited' })}
        scopes={[{ value: `division:${divisionId}`, label: 'U13 division' }]}
      />,
    );

    expect(screen.getByLabelText('Evaluator email')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send evaluator invitation' })).toHaveClass(
      'min-h-11',
    );
    expect(screen.getByRole('button', { name: 'Assign evaluator' })).toHaveClass('min-h-11');
  });
});
