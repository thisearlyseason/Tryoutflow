import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { Database, Json } from '../../../infrastructure/supabase/database.types';
import { parseOrganizationId, parseUserId, type OrganizationId } from '../../../lib/ids';
import { requireCapability } from './require-capability';
import { SupabaseMembershipRepository } from '../infrastructure/membership-repository';

function stringRecord(value: Json): Record<string, string> {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function strings(value: Json): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Converts byte-free member metadata into the only branding field exposed to shell views. */
export async function loadOrganizationLogoUrl(
  client: SupabaseClient<Database>,
  organization: Readonly<{ id: OrganizationId; slug: string }>,
) {
  try {
    const result = await client.rpc('get_organization_logo_metadata', {
      p_organization_id: organization.id,
    });
    const metadata = result.data?.length === 1 ? result.data[0] : undefined;
    if (
      result.error ||
      !metadata?.logo_exists ||
      !metadata.updated_at ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
        metadata.updated_at,
      ) ||
      Number.isNaN(Date.parse(metadata.updated_at)) ||
      !metadata.sha256 ||
      !/^[0-9a-f]{64}$/u.test(metadata.sha256)
    ) {
      return undefined;
    }
    return `/api/organizations/${encodeURIComponent(organization.slug)}/logo?v=${encodeURIComponent(metadata.updated_at)}`;
  } catch {
    return undefined;
  }
}

/** Resolves direct organization routes from current server session and database membership, never URL trust. */
export async function requireCurrentOrganization(slug: string) {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) notFound();
  const organizationResult = await client
    .from('organizations')
    .select('id, name, slug, timezone, terminology, sport_defaults, tag_defaults')
    .eq('slug', slug)
    .maybeSingle();
  if (organizationResult.error || !organizationResult.data) notFound();
  const organizationId = parseOrganizationId(organizationResult.data.id);
  const authorization = await new SupabaseMembershipRepository(client).findAuthorizationContext(
    parseUserId(user.id),
    organizationId,
  );
  if (
    !authorization ||
    !requireCapability(authorization, 'organization:read', { organizationId }).ok
  )
    notFound();
  const logoUrl = await loadOrganizationLogoUrl(client, {
    id: organizationId,
    slug: organizationResult.data.slug,
  });
  return {
    client,
    userId: parseUserId(user.id),
    authorization,
    organization: {
      id: organizationId,
      name: organizationResult.data.name,
      slug: organizationResult.data.slug,
      timezone: organizationResult.data.timezone,
      terminology: stringRecord(organizationResult.data.terminology),
      sportDefaults: strings(organizationResult.data.sport_defaults),
      tagDefaults: strings(organizationResult.data.tag_defaults),
      ...(logoUrl ? { logoUrl } : {}),
    },
  };
}
