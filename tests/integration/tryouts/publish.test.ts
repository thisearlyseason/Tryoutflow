import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import {
  canonicalRegistrationUrl,
  publishTryout,
  validateTryoutForPublish,
  type PublishBlocker,
  type PublishTryoutGateway,
} from '../../../src/modules/tryouts/application/publish-tryout';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const tryoutId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerId = '11111111-1111-4111-8111-111111111111' as UserId;

const directorAuthorization: AuthorizationContext = {
  userId: ownerId,
  organizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

function gateway(
  outcome: Parameters<PublishTryoutGateway['publish']>[0] extends never ? never : unknown,
) {
  return {
    publish: vi.fn(async () => outcome),
  } as unknown as PublishTryoutGateway;
}

describe('tryout publication', () => {
  it('rejects publication when rubric weights total 90', async () => {
    const repository = gateway({ kind: 'rubric_invalid' });

    const result = await publishTryout(
      { organizationId, tryoutId, expectedVersion: 4 },
      { authorization: directorAuthorization },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'rubric_invalid' } });
  });

  it.each([
    'division_missing',
    'session_missing',
    'registration_form_missing',
    'registration_closed',
  ] as const)('maps the database %s blocker without claiming publication', async (blocker) => {
    const repository = gateway({ kind: blocker });
    await expect(
      publishTryout(
        { organizationId, tryoutId, expectedVersion: 4 },
        { authorization: directorAuthorization },
        { gateway: repository },
      ),
    ).resolves.toEqual({ ok: false, error: { code: blocker } });
  });

  it('does not call the atomic command when current authorization lacks publish capability', async () => {
    const repository = gateway({ kind: 'published', publicSlug: 'fall-id-camp' });
    const result = await publishTryout(
      { organizationId, tryoutId, expectedVersion: 4 },
      {
        authorization: {
          ...directorAuthorization,
          organizationRole: 'member',
          assignments: [],
        },
      },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(repository.publish).not.toHaveBeenCalled();
  });

  it('uses one idempotent persistence command for a double-click and returns the canonical URL', async () => {
    const repository = gateway({ kind: 'already_published', publicSlug: 'fall-id-camp' });

    const result = await publishTryout(
      { organizationId, tryoutId, expectedVersion: 4 },
      { authorization: directorAuthorization },
      { gateway: repository, publicOrigin: 'https://app.tryoutflow.example/' },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        alreadyPublished: true,
        registrationUrl: 'https://app.tryoutflow.example/register/fall-id-camp',
      },
    });
    expect(repository.publish).toHaveBeenCalledWith({
      organizationId,
      tryoutId,
      expectedVersion: 4,
    });
  });

  it('returns database validation blockers for the wizard review step', async () => {
    const repository = {
      validate: vi.fn(async (): Promise<PublishBlocker[]> => [
        'division_missing',
        'rubric_invalid',
      ]),
    };

    await expect(
      validateTryoutForPublish(
        { organizationId, tryoutId },
        { authorization: directorAuthorization },
        {
          gateway: repository,
        },
      ),
    ).resolves.toEqual({ ok: true, value: { blockers: ['division_missing', 'rubric_invalid'] } });
  });

  it('fails closed for an insecure production registration origin', () => {
    expect(() => canonicalRegistrationUrl('http://tryoutflow.example', 'fall-id-camp')).toThrow(
      /secure/i,
    );
  });
});
