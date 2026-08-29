import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
    const scope: EvaluationScope = { kind: 'group', groupId };
    const registrations = [
      { registrationId: 'a', tryoutId, divisionId, sessionId, groupId },
      { registrationId: 'b', tryoutId, divisionId, sessionId, groupId: 'other' },
      { registrationId: 'c', tryoutId, divisionId, sessionId: 'other', groupId: 'other' },
    ];

    expect(resolveAssignedRegistrations({ tryoutId, scope }, registrations)).toEqual(['a']);
  });

  it('accepts only the IDs represented by the database scope discriminator', async () => {
    const gateway = { assign: async () => ({ outcome: 'assigned' as const }) };

    await expect(
      assignEvaluator(
        {
          organizationId,
          evaluatorUserId: evaluatorId,
          tryoutId,
          scope: { kind: 'session', sessionId },
        },
        owner,
        gateway,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      assignEvaluator(
        {
          organizationId,
          evaluatorUserId: evaluatorId,
          tryoutId,
          scope: { kind: 'session', sessionId, divisionId },
        },
        owner,
        gateway,
      ),
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_input' } });
  });

  it('authorizes a group director from the group-only evaluator scope discriminator', async () => {
    const groupDirector: AuthorizationContext = {
      ...owner,
      organizationRole: 'member',
      assignments: [{ role: 'director', scope: { kind: 'group', tryoutId, sessionId, groupId } }],
    };

    await expect(
      assignEvaluator(
        {
          organizationId,
          evaluatorUserId: evaluatorId,
          tryoutId,
          scope: { kind: 'group', groupId },
        },
        groupDirector,
        { assign: async () => ({ outcome: 'assigned' }) },
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('rejects a scope with mismatched tenant relationships at the gateway boundary', async () => {
    const result = await assignEvaluator(
      {
        organizationId,
        evaluatorUserId: evaluatorId,
        tryoutId,
        scope: { kind: 'session', sessionId },
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
      tryoutId,
      scope: { kind: 'division' as const, divisionId },
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
            divisionId,
            sessionId,
            groupId: null,
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
        onInvite={async () => ({ outcome: 'manual_share', shareUrl: '/invite/secret' })}
        onRevoke={async () => ({ outcome: 'revoked' })}
        assignments={[]}
        scopes={[{ value: `division:${divisionId}`, label: 'U13 division' }]}
      />,
    );

    expect(screen.getByLabelText('Evaluator email')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create invitation link' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Assign evaluator' })).toHaveClass('min-h-11');
  });

  it('keeps a manual invitation link visible when copying fails and offers an open action', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error('denied')) },
    });
    render(
      <AssignmentWorkspace
        assignments={[]}
        evaluators={[]}
        onAssign={async () => ({ outcome: 'assigned' })}
        onInvite={async () => ({ outcome: 'manual_share', shareUrl: '/invite/one-time-token' })}
        onRevoke={async () => ({ outcome: 'revoked' })}
        scopes={[]}
      />,
    );

    await user.type(screen.getByLabelText('Evaluator email'), 'coach@example.test');
    await user.click(screen.getByRole('button', { name: 'Create invitation link' }));

    expect(await screen.findByLabelText('One-time invitation link')).toHaveValue(
      '/invite/one-time-token',
    );
    expect(screen.getAllByText(/email was not sent/i)).toHaveLength(2);
    expect(screen.getByText(/expir/i)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open invitation link' })).toHaveAttribute(
      'href',
      '/invite/one-time-token',
    );
    await user.click(screen.getByRole('button', { name: 'Copy invitation link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/copy failed/i);
    expect(screen.getByLabelText('One-time invitation link')).toHaveValue('/invite/one-time-token');
  });

  it('shows manageable active grants and reports a truthful audited revoke outcome', async () => {
    const user = userEvent.setup();
    render(
      <AssignmentWorkspace
        assignments={[
          {
            assignmentId: '77777777-7777-4777-8777-777777777777',
            evaluatorUserId: evaluatorId,
            evaluatorName: 'Evan Evaluator',
            scopeLabel: 'Skills — Blue',
            scopeKind: 'group',
            expiresAt: null,
          },
        ]}
        evaluators={[]}
        onAssign={async () => ({ outcome: 'assigned' })}
        onInvite={async () => ({ outcome: 'manual_share', shareUrl: '/invite/secret' })}
        onRevoke={async () => ({ outcome: 'revoked' })}
        scopes={[]}
      />,
    );

    expect(screen.getByText('Evan Evaluator')).toBeVisible();
    expect(screen.getByText('Skills — Blue')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Revoke Evan Evaluator from Skills — Blue' }),
    );
    expect(await screen.findByText(/revoked and recorded in the audit log/i)).toBeVisible();
    expect(screen.queryByText('Evan Evaluator')).not.toBeInTheDocument();
  });

  it('does not claim email was unsent when notifier delivery was queued', async () => {
    const user = userEvent.setup();
    render(
      <AssignmentWorkspace
        assignments={[]}
        evaluators={[]}
        onAssign={async () => ({ outcome: 'assigned' })}
        onInvite={async () => ({
          outcome: 'notifier_enqueued',
          shareUrl: '/invite/recovery-token',
        })}
        onRevoke={async () => ({ outcome: 'revoked' })}
        scopes={[]}
      />,
    );

    await user.type(screen.getByLabelText('Evaluator email'), 'coach@example.test');
    await user.click(screen.getByRole('button', { name: 'Create invitation link' }));
    expect(await screen.findAllByText(/delivery was queued/i)).toHaveLength(2);
    expect(screen.queryByText(/email was not sent/i)).not.toBeInTheDocument();
  });

  it('preserves the last valid manual link when a later creation attempt fails', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    render(
      <AssignmentWorkspace
        assignments={[]}
        evaluators={[]}
        onAssign={async () => ({ outcome: 'assigned' })}
        onInvite={async () =>
          attempt++ === 0
            ? { outcome: 'manual_share', shareUrl: '/invite/still-valid' }
            : { outcome: 'unexpected' }
        }
        onRevoke={async () => ({ outcome: 'revoked' })}
        scopes={[]}
      />,
    );

    await user.type(screen.getByLabelText('Evaluator email'), 'coach@example.test');
    await user.click(screen.getByRole('button', { name: 'Create invitation link' }));
    await user.click(screen.getByRole('button', { name: 'Create invitation link' }));
    expect(screen.getByLabelText('One-time invitation link')).toHaveValue('/invite/still-valid');
    expect(screen.getAllByText(/email was not sent/i)).toHaveLength(1);
    expect(screen.getByText(/could not be created/i)).toBeVisible();
  });
});
