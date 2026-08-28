import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId } from '../../../lib/ids';
import type { LifecycleTransition, TryoutDraft, TryoutGateway } from '../domain/tryout';

type TryoutRow = {
  tryout_id: string;
  organization_id: string;
  season_id: string | null;
  name: string;
  slug: string;
  sport: string;
  timezone: string;
  status: 'draft' | 'published' | 'finalized';
  registration_starts_at: string | null;
  registration_ends_at: string | null;
  published_at: string | null;
  finalized_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

function toTryoutDraft(row: TryoutRow): TryoutDraft {
  return {
    id: row.tryout_id,
    organizationId: row.organization_id as OrganizationId,
    seasonId: row.season_id,
    name: row.name,
    slug: row.slug,
    sport: row.sport,
    timezone: row.timezone,
    status: row.status,
    registrationStartsAt: row.registration_starts_at ? new Date(row.registration_starts_at) : null,
    registrationEndsAt: row.registration_ends_at ? new Date(row.registration_ends_at) : null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    finalizedAt: row.finalized_at ? new Date(row.finalized_at) : null,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class SupabaseTryoutGateway implements TryoutGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async createDraft(input: Omit<TryoutDraft, 'id'>): Promise<TryoutDraft> {
    const result = await this.client.rpc('create_tryout_draft', {
      p_organization_id: input.organizationId,
      // Supabase's generated RPC types currently model nullable PostgreSQL
      // parameters as strings even though the function accepts SQL NULL.
      p_season_id: input.seasonId as unknown as string,
      p_name: input.name,
      p_slug: input.slug,
      p_sport: input.sport,
      p_timezone: input.timezone,
      p_registration_starts_at: (input.registrationStartsAt?.toISOString() ??
        null) as unknown as string,
      p_registration_ends_at: (input.registrationEndsAt?.toISOString() ??
        null) as unknown as string,
    });
    if (result.error || !result.data?.[0]) {
      throw result.error ?? new Error('Tryout draft creation failed');
    }
    return toTryoutDraft(result.data[0] as TryoutRow);
  }

  async transitionLifecycle(input: {
    organizationId: OrganizationId;
    tryoutId: string;
    expectedVersion: number;
    action: 'publish' | 'finalize';
    requestedAt: Date;
  }): Promise<LifecycleTransition> {
    const result = await this.client.rpc('transition_tryout_lifecycle', {
      p_organization_id: input.organizationId,
      p_tryout_id: input.tryoutId,
      p_expected_version: input.expectedVersion,
      p_action: input.action,
    });
    if (result.error || !result.data?.[0]) {
      throw result.error ?? new Error('Tryout lifecycle transition failed');
    }
    const row = result.data[0] as TryoutRow & { outcome: string };
    if (row.outcome === 'updated') return { kind: 'updated', tryout: toTryoutDraft(row) };
    if (row.outcome === 'not_found' || row.outcome === 'conflict') return { kind: row.outcome };
    return { kind: 'invalid_transition' };
  }
}
