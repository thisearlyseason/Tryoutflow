import { notFound } from 'next/navigation';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { parseOrganizationId, parseUserId } from '../../../lib/ids';
import { requireCapability } from './require-capability';
import { SupabaseMembershipRepository } from '../infrastructure/membership-repository';

/** Resolves direct organization routes from current server session and database membership, never URL trust. */
export async function requireCurrentOrganization(slug: string) {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) notFound();
  const organizationResult = await client
    .from('organizations')
    .select('id, name, slug, timezone')
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
    organization: { ...organizationResult.data, id: organizationId },
  };
}
