import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId, UserId } from '../../../lib/ids';
import type {
  CreateOrganizationRecord,
  InvitationAcceptance,
  InvitationRecord,
  OrganizationGateway,
  OrganizationSettings,
} from '../domain/organization';

function parseStringRecord(value: Json | null): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function parseStrings(value: Json | null): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export class SupabaseOrganizationGateway implements OrganizationGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async createWithOwner(input: CreateOrganizationRecord) {
    const result = await this.client.rpc('create_organization_with_owner', {
      p_name: input.name,
      p_slug: input.slug,
      p_timezone: input.timezone,
      p_terminology: input.terminology,
      p_sport_defaults: input.sportDefaults,
      p_tag_defaults: input.tagDefaults,
    });
    if (result.error?.code === '23505') return { kind: 'slug_conflict' } as const;
    if (result.error || !result.data?.[0])
      throw result.error ?? new Error('Organization creation failed');
    const row = result.data[0];
    return {
      organization: {
        id: row.organization_id as OrganizationId,
        name: row.organization_name,
        slug: row.organization_slug,
        timezone: row.timezone,
        terminology: parseStringRecord(row.terminology),
        sportDefaults: parseStrings(row.sport_defaults),
        tagDefaults: parseStrings(row.tag_defaults),
      },
      membership: {
        organizationId: row.organization_id as OrganizationId,
        userId: row.owner_user_id as UserId,
        role: 'owner' as const,
      },
    };
  }

  async createInvitation(input: InvitationRecord): Promise<{ id: string }> {
    const result = await this.client.rpc('create_organization_invitation', {
      p_organization_id: input.organizationId,
      p_email: input.email,
      p_role: input.role,
      p_token_digest: input.tokenDigest,
      p_expires_at: input.expiresAt.toISOString(),
      p_invitation_id: input.id,
    });
    const row = result.data?.[0];
    if (result.error) throw result.error;
    if (row?.outcome === 'conflict') throw { code: '23505' };
    if (row?.outcome !== 'created' || !row.invitation_id)
      throw new Error('Invitation creation failed');
    return { id: row.invitation_id };
  }

  async acceptInvitation(tokenDigest: string): Promise<InvitationAcceptance> {
    const result = await this.client.rpc('accept_organization_invitation', {
      p_token_digest: tokenDigest,
    });
    if (result.error || !result.data?.[0]) return { kind: 'invalid' };
    const row = result.data[0];
    if (
      row.outcome !== 'accepted' &&
      ['expired', 'wrong_email', 'duplicate_membership', 'unverified', 'invalid'].includes(
        row.outcome,
      )
    ) {
      return { kind: row.outcome as Exclude<InvitationAcceptance, { kind: 'accepted' }>['kind'] };
    }
    if (row.outcome !== 'accepted') return { kind: 'invalid' };
    return {
      kind: 'accepted',
      organizationId: row.organization_id as OrganizationId,
      organizationSlug: row.organization_slug,
    };
  }

  async updateSettings(
    input: { organizationId: OrganizationId } & Partial<OrganizationSettings>,
  ): Promise<OrganizationSettings> {
    const changes: Database['public']['Tables']['organizations']['Update'] = {};
    if (input.timezone !== undefined) changes.timezone = input.timezone;
    if (input.terminology !== undefined) changes.terminology = input.terminology;
    if (input.sportDefaults !== undefined) changes.sport_defaults = input.sportDefaults;
    if (input.tagDefaults !== undefined) changes.tag_defaults = input.tagDefaults;
    const result = await this.client
      .from('organizations')
      .update(changes)
      .eq('id', input.organizationId)
      .select('timezone, terminology, sport_defaults, tag_defaults')
      .single();
    if (result.error) throw result.error;
    return {
      timezone: result.data.timezone,
      terminology: parseStringRecord(result.data.terminology),
      sportDefaults: parseStrings(result.data.sport_defaults),
      tagDefaults: parseStrings(result.data.tag_defaults),
    };
  }
}
