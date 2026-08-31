import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../../../src/lib/clock';
import type { OrganizationId, UserId } from '../../../src/lib/ids';
import { createTryout } from '../../../src/modules/tryouts/application/create-tryout';
import { updateTryoutStep } from '../../../src/modules/tryouts/application/update-tryout-step';
import type { TryoutDraft, TryoutGateway } from '../../../src/modules/tryouts/domain/tryout';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const ownerId = '11111111-1111-4111-8111-111111111111' as UserId;
const tryoutId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ownerAuthorization: AuthorizationContext = {
  userId: ownerId,
  organizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};

const storedDraft: TryoutDraft = {
  id: tryoutId,
  organizationId,
  seasonId: null,
  name: 'Fall ID Camp',
  slug: 'fall-id-camp',
  sport: 'Hockey',
  timezone: 'America/Edmonton',
  status: 'draft',
  registrationStartsAt: null,
  registrationEndsAt: null,
  publishedAt: null,
  finalizedAt: null,
  version: 0,
  createdAt: new Date('2026-08-28T12:00:00.000Z'),
  updatedAt: new Date('2026-08-28T12:00:00.000Z'),
};

function gateway(overrides: Partial<TryoutGateway> = {}): TryoutGateway {
  const transitionLifecycle = vi.fn(
    async (input: Parameters<TryoutGateway['transitionLifecycle']>[0]) => ({
      kind: 'updated' as const,
      tryout: {
        ...storedDraft,
        status: (input.action === 'publish' ? 'published' : 'finalized') as TryoutDraft['status'],
        publishedAt: input.action === 'publish' ? input.requestedAt : storedDraft.publishedAt,
        finalizedAt: input.action === 'finalize' ? input.requestedAt : null,
        version: input.expectedVersion + 1,
      },
    }),
  );
  return {
    createDraft: vi.fn(async (input) => ({ ...storedDraft, ...input, id: tryoutId })),
    transitionLifecycle,
    ...overrides,
  };
}

describe('tryout configuration commands', () => {
  it('creates a tenant-scoped draft using the supplied clock', async () => {
    const repository = gateway();
    const now = new Date('2026-08-28T13:00:00.000Z');

    const result = await createTryout(
      {
        organizationId,
        name: 'Fall ID Camp',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
      },
      { authorization: ownerAuthorization },
      { gateway: repository, clock: new FixedClock(now) },
    );

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ status: 'draft' }) });
    expect(repository.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, createdAt: now, updatedAt: now }),
    );
  });

  it('rejects a stale organization authorization before persisting a draft', async () => {
    const repository = gateway();

    const result = await createTryout(
      {
        organizationId,
        name: 'Fall ID Camp',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
      },
      {
        authorization: {
          ...ownerAuthorization,
          organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrganizationId,
        },
      },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(repository.createDraft).not.toHaveBeenCalled();
  });

  it('does not persist a registration window with an invalid instant range', async () => {
    const repository = gateway();
    const result = await createTryout(
      {
        organizationId,
        name: 'Fall ID Camp',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
        registrationStartsAt: '2026-09-10T17:00:00.000Z',
        registrationEndsAt: '2026-09-10T17:00:00.000Z',
      },
      { authorization: ownerAuthorization },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'invalid_time_range' } });
    expect(repository.createDraft).not.toHaveBeenCalled();
  });

  it('interprets browser datetime-local registration values in the tryout timezone', async () => {
    const repository = gateway();

    const result = await createTryout(
      {
        organizationId,
        name: 'Fall ID Camp',
        sport: 'Hockey',
        timezone: 'America/Edmonton',
        registrationStartsAt: '2026-09-01T08:00',
        registrationEndsAt: '2026-09-30T20:00',
      },
      { authorization: ownerAuthorization },
      { gateway: repository },
    );

    expect(result.ok).toBe(true);
    expect(repository.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationStartsAt: new Date('2026-09-01T14:00:00.000Z'),
        registrationEndsAt: new Date('2026-10-01T02:00:00.000Z'),
      }),
    );
  });

  it('sends an expected version to the atomic publish transition', async () => {
    const repository = gateway();
    const finalizedAt = new Date('2026-08-28T14:00:00.000Z');

    const result = await updateTryoutStep(
      { organizationId, tryoutId, expectedVersion: 0, action: 'publish' },
      { authorization: ownerAuthorization },
      { gateway: repository, clock: new FixedClock(finalizedAt) },
    );

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ status: 'published' }) });
    expect(repository.transitionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        tryoutId,
        expectedVersion: 0,
        action: 'publish',
        requestedAt: finalizedAt,
      }),
    );
  });

  it('uses an atomic finalize transition instead of a read-then-write sequence', async () => {
    const finalizedAt = new Date('2026-08-28T14:00:00.000Z');
    const repository = gateway();

    const result = await updateTryoutStep(
      { organizationId, tryoutId, expectedVersion: 1, action: 'finalize' },
      { authorization: ownerAuthorization },
      { gateway: repository, clock: new FixedClock(finalizedAt) },
    );

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ status: 'finalized' }) });
    expect(repository.transitionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'finalize', expectedVersion: 1, requestedAt: finalizedAt }),
    );
  });

  it('surfaces a stale compare-and-swap version without persisting a transition', async () => {
    const repository = gateway({
      transitionLifecycle: vi.fn(async () => ({ kind: 'conflict' as const })),
    });

    const result = await updateTryoutStep(
      { organizationId, tryoutId, expectedVersion: 0, action: 'publish' },
      { authorization: ownerAuthorization },
      { gateway: repository },
    );

    expect(result).toEqual({ ok: false, error: { code: 'conflict' } });
    expect(repository.transitionLifecycle).toHaveBeenCalledTimes(1);
  });
});
