import { describe, expect, it } from 'vitest';

import { can } from '../../../src/modules/organizations/application/capabilities';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { OrganizationId, UserId } from '../../../src/lib/ids';

const ownerA = '11111111-1111-4111-8111-111111111111' as UserId;
const evaluator = '22222222-2222-4222-8222-222222222222' as UserId;
const checkinStaff = '33333333-3333-4333-8333-333333333333' as UserId;
const organizationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const organizationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrganizationId;
const assignedTryout = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const assignedSession = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const ownerAContext: AuthorizationContext = {
  userId: ownerA,
  organizationId: organizationA,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

const evaluatorContext: AuthorizationContext = {
  userId: evaluator,
  organizationId: organizationA,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [
    {
      role: 'evaluator',
      scope: { kind: 'session', tryoutId: assignedTryout, sessionId: assignedSession },
    },
  ],
};

const checkinContext: AuthorizationContext = {
  userId: checkinStaff,
  organizationId: organizationA,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [{ role: 'checkin', scope: { kind: 'tryout', tryoutId: assignedTryout } }],
};

describe('capabilities', () => {
  it('allows an active member to enter the organization shell before scoped authorization', () => {
    expect(can(checkinContext, 'organization:read', { organizationId: organizationA })).toBe(true);
  });

  it('allows an evaluator to update only an assigned evaluation of their own', () => {
    expect(
      can(evaluatorContext, 'evaluation:update-own', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
        sessionId: assignedSession,
        evaluatorUserId: evaluator,
      }),
    ).toBe(true);
  });

  it('denies evaluator ranking access even within an assigned tryout', () => {
    expect(
      can(evaluatorContext, 'ranking:read', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
      }),
    ).toBe(false);
  });

  it('denies check-in staff evaluation access', () => {
    expect(
      can(checkinContext, 'evaluation:read', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
      }),
    ).toBe(false);
  });

  it('allows an evaluator to read only their own assigned evaluation', () => {
    const assignedEvaluation = {
      organizationId: organizationA,
      tryoutId: assignedTryout,
      sessionId: assignedSession,
      evaluatorUserId: evaluator,
    };

    expect(can(evaluatorContext, 'evaluation:read', assignedEvaluation)).toBe(true);
    expect(
      can(evaluatorContext, 'evaluation:read', { ...assignedEvaluation, evaluatorUserId: ownerA }),
    ).toBe(false);

    const unassignedEvaluatorContext: AuthorizationContext = {
      userId: evaluator,
      organizationId: organizationA,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [],
    };
    expect(can(unassignedEvaluatorContext, 'evaluation:read', assignedEvaluation)).toBe(false);
  });

  it('denies owner access to another organization resource', () => {
    expect(can(ownerAContext, 'athlete:read', { organizationId: organizationB })).toBe(false);
  });

  it('denies an evaluator outside their assigned session and another evaluator evaluation', () => {
    expect(
      can(evaluatorContext, 'evaluation:update-own', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
        sessionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        evaluatorUserId: evaluator,
      }),
    ).toBe(false);

    expect(
      can(evaluatorContext, 'evaluation:update-own', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
        sessionId: assignedSession,
        evaluatorUserId: ownerA,
      }),
    ).toBe(false);
  });

  it('allows reviewers to read an explicitly granted finalized report but never mutate it', () => {
    const reviewerContext: AuthorizationContext = {
      userId: ownerA,
      organizationId: organizationA,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [{ role: 'reviewer', scope: { kind: 'tryout', tryoutId: assignedTryout } }],
    };

    const finalizedRoster = {
      organizationId: organizationA,
      tryoutId: assignedTryout,
      finalized: true,
    };

    expect(can(reviewerContext, 'roster:read', finalizedRoster)).toBe(true);
    expect(can(reviewerContext, 'roster:write', finalizedRoster)).toBe(false);
  });

  it('denies malformed runtime contexts that do not carry an active membership role', () => {
    const untrustedContext = {
      ...evaluatorContext,
      membershipStatus: 'disabled',
    } as unknown as AuthorizationContext;

    expect(
      can(untrustedContext, 'evaluation:update-own', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
        sessionId: assignedSession,
        evaluatorUserId: evaluator,
      }),
    ).toBe(false);
  });

  it('keeps a division grant bounded by both its tryout and division', () => {
    const divisionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const divisionContext: AuthorizationContext = {
      userId: evaluator,
      organizationId: organizationA,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [
        { role: 'director', scope: { kind: 'division', tryoutId: assignedTryout, divisionId } },
      ],
    };

    expect(
      can(divisionContext, 'tryout:read', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
        divisionId,
      }),
    ).toBe(true);
    expect(
      can(divisionContext, 'tryout:read', {
        organizationId: organizationA,
        tryoutId: assignedTryout,
        divisionId: 'abababab-abab-4bab-8bab-abababababab',
      }),
    ).toBe(false);
    expect(can(divisionContext, 'tryout:read', { organizationId: organizationA })).toBe(false);
  });
});
