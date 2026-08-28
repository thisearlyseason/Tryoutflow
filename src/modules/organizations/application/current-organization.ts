import { notFound } from 'next/navigation';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { Json } from '../../../infrastructure/supabase/database.types';
import { parseOrganizationId, parseUserId } from '../../../lib/ids';
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
    },
  };
}
