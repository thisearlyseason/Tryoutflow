import { describe, expect, it, vi } from 'vitest';

import { SupabaseTryoutGateway } from '../../../src/modules/tryouts/infrastructure/supabase-tryout-gateway';
import type { OrganizationId } from '../../../src/lib/ids';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;

describe('SupabaseTryoutGateway', () => {
  it('creates a draft through the atomic create RPC instead of a table insert', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          tryout_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          organization_id: organizationId,
          season_id: null,
          name: 'Fall ID Camp',
          slug: 'fall-id-camp',
          sport: 'Hockey',
          timezone: 'America/Edmonton',
          status: 'draft',
          registration_starts_at: null,
          registration_ends_at: null,
          published_at: null,
          finalized_at: null,
          version: 0,
          created_at: '2026-08-28T12:00:00.000Z',
          updated_at: '2026-08-28T12:00:00.000Z',
        },
      ],
      error: null,
    }));
    const gateway = new SupabaseTryoutGateway({ rpc } as never);

    await gateway.createDraft({
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
    });

    expect(rpc).toHaveBeenCalledWith('create_tryout_draft', {
      p_name: 'Fall ID Camp',
      p_organization_id: organizationId,
      p_registration_ends_at: null,
      p_registration_starts_at: null,
      p_season_id: null,
      p_slug: 'fall-id-camp',
      p_sport: 'Hockey',
      p_timezone: 'America/Edmonton',
    });
  });

  it('sends the expected version to the atomic lifecycle RPC and returns its updated record', async () => {
    const rpc = vi.fn(async () => ({
      data: [
        {
          outcome: 'updated',
          tryout_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          organization_id: organizationId,
          season_id: null,
          name: 'Fall ID Camp',
          slug: 'fall-id-camp',
          sport: 'Hockey',
          timezone: 'America/Edmonton',
          status: 'published',
          registration_starts_at: null,
          registration_ends_at: null,
          published_at: '2026-08-28T12:00:00.000Z',
          finalized_at: null,
          version: 1,
          created_at: '2026-08-28T12:00:00.000Z',
          updated_at: '2026-08-28T12:00:00.000Z',
        },
      ],
      error: null,
    }));
    const gateway = new SupabaseTryoutGateway({ rpc } as never);

    const result = await gateway.transitionLifecycle({
      organizationId,
      tryoutId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      expectedVersion: 0,
      action: 'publish',
      requestedAt: new Date('2026-08-28T12:00:00.000Z'),
    });

    expect(rpc).toHaveBeenCalledWith('transition_tryout_lifecycle', {
      p_action: 'publish',
      p_expected_version: 0,
      p_organization_id: organizationId,
      p_tryout_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(result).toEqual(
      expect.objectContaining({ kind: 'updated', tryout: expect.objectContaining({ version: 1 }) }),
    );
  });
});
