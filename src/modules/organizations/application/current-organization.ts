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
export async function requireCurrentOrganization(
  slug: string,
  options: { includeBranding?: boolean } = {},
) {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) notFound();
  const context = await new SupabaseMembershipRepository(client).findOrganizationContext(
    parseUserId(user.id),
    slug,
  );
  if (!context) notFound();
  const { organization, authorization } = context;
  const organizationId = parseOrganizationId(organization.id);
  if (
    !authorization ||
    !requireCapability(authorization, 'organization:read', { organizationId }).ok
  )
    notFound();
  // The layout loads its own branding. Only logo settings need it again.
  const logoUrl = options.includeBranding
    ? await loadOrganizationLogoUrl(client, { id: organizationId, slug: organization.slug })
    : undefined;
  return {
    client,
    userId: parseUserId(user.id),
    authorization,
    organization: {
      id: organizationId,
      name: organization.name,
      slug: organization.slug,
      timezone: organization.timezone,
      terminology: stringRecord(organization.terminology),
      sportDefaults: strings(organization.sport_defaults),
      tagDefaults: strings(organization.tag_defaults),
      ...(logoUrl ? { logoUrl } : {}),
    },
  };
}
