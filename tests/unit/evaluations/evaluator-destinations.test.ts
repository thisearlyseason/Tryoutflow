import { describe, expect, it } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  firstIncompleteAssignedAthlete,
  resolveEvaluatorDestinations,
} from '../../../src/modules/evaluations/application/list-evaluator-destinations';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = '22222222-2222-4222-8222-222222222222';
const divisionId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';

describe('evaluator destinations', () => {
  it('projects only safe labels for exact active evaluator scopes', () => {
    const evaluator: AuthorizationContext = {
      userId,
      organizationId,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [
        { role: 'evaluator', scope: { kind: 'session', tryoutId, sessionId } },
        {
          role: 'director',
          scope: {
            kind: 'session',
            tryoutId: '99999999-9999-4999-8999-999999999999',
            sessionId: '88888888-8888-4888-8888-888888888888',
          },
        },
      ],
    };
    const result = resolveEvaluatorDestinations(
      evaluator,
      [
        { organizationId, id: tryoutId, name: 'Fall tryouts', status: 'published' },
        {
          organizationId: '77777777-7777-4777-8777-777777777777',
          id: tryoutId,
          name: 'Other tenant private name',
          status: 'published',
        },
      ],
      [
        {
          organizationId,
          id: sessionId,
          tryoutId,
          divisionId,
          name: 'Morning skills',
        },
        {
          organizationId,
          id: '55555555-5555-4555-8555-555555555555',
          tryoutId,
          divisionId,
          name: 'Unassigned session',
        },
      ],
    );

    expect(result).toEqual([
      { tryoutId, tryoutName: 'Fall tryouts', sessionId, sessionName: 'Morning skills' },
    ]);
    expect(JSON.stringify(result)).not.toContain('Other tenant');
    expect(JSON.stringify(result)).not.toContain('athlete');
  });

  it('returns no destinations after evaluator grants are absent or a tryout is not active', () => {
    const revokedOrOffboarded: AuthorizationContext = {
      userId,
      organizationId,
      organizationRole: 'member',
      membershipStatus: 'active',
      assignments: [],
    };
    expect(
      resolveEvaluatorDestinations(
        revokedOrOffboarded,
        [{ organizationId, id: tryoutId, name: 'Draft', status: 'draft' }],
        [{ organizationId, id: sessionId, tryoutId, divisionId, name: 'Private session' }],
      ),
    ).toEqual([]);
  });

  it('continues at the first incomplete athlete and falls back when all are complete', () => {
    const athletes = [
      { registrationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' },
      { registrationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' },
      { registrationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3' },
    ];
    const evaluations = [
      { registrationId: athletes[0]!.registrationId, state: 'completed' as const },
      { registrationId: athletes[1]!.registrationId, state: 'draft' as const },
    ];
    expect(firstIncompleteAssignedAthlete(athletes, evaluations)).toBe(athletes[1]!.registrationId);
    expect(
      firstIncompleteAssignedAthlete(athletes, [
        ...evaluations,
        { registrationId: athletes[1]!.registrationId, state: 'locked' as const },
        { registrationId: athletes[2]!.registrationId, state: 'completed' as const },
      ]),
    ).toBeNull();
  });
});
