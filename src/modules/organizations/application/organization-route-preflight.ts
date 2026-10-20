import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import { parseOrganizationId, parseUserId } from '../../../lib/ids';
import { SupabaseMembershipRepository } from '../infrastructure/membership-repository';
import { can } from './capabilities';

/** Deny protected document routes before the loading shell starts streaming. Page/RLS checks remain authoritative. */
export async function organizationRoutePreflight(
  client: SupabaseClient<Database>,
  userId: string,
  url: URL,
): Promise<boolean> {
  const segments = url.pathname.split('/');
  if (segments[1] !== 'app' || !segments[2]) return true;
  let slug: string;
  try {
    slug = decodeURIComponent(segments[2]);
  } catch {
    return false;
  }
  const result = await client.from('organizations').select('id').eq('slug', slug).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return false;
  const organizationId = parseOrganizationId(result.data.id);
  const authorization = await new SupabaseMembershipRepository(client).findAuthorizationContext(
    parseUserId(userId),
    organizationId,
  );
  if (!authorization || !can(authorization, 'organization:read', { organizationId })) return false;
  if (segments[3] === 'organization' && segments[4] === 'audit')
    return can(authorization, 'audit:read', { organizationId });
  if (segments[3] !== 'tryouts' || !segments[4]) return true;
  const tryoutId = segments[4];
  if (['rosters', 'check-in'].includes(segments[5] ?? '') && !z.uuid().safeParse(tryoutId).success)
    return false;
  if (segments[5] === 'rosters') {
    const [{ data: divisions, error: divisionError }, { data: versions, error: versionError }] =
      await Promise.all([
        client
          .from('tryout_divisions')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('tryout_id', tryoutId)
          .order('sort_order'),
        client
          .from('roster_versions')
          .select('division_id,state')
          .eq('organization_id', organizationId)
          .eq('tryout_id', tryoutId)
          .order('revision_number', { ascending: false }),
      ]);
    if (divisionError || versionError) throw divisionError ?? versionError;
    const requestedDivision = url.searchParams.get('division');
    if (requestedDivision !== null && !z.uuid().safeParse(requestedDivision).success) return false;
    const divisionId =
      requestedDivision ??
      versions?.[0]?.division_id ??
      divisions?.find((division) =>
        can(authorization, 'roster:write', { organizationId, tryoutId, divisionId: division.id }),
      )?.id;
    if (!divisionId || !divisions?.some((division) => division.id === divisionId)) return false;
    const roster = versions?.find((version) => version.division_id === divisionId);
    return (
      can(authorization, 'roster:read', {
        organizationId,
        tryoutId,
        divisionId,
        finalized: roster?.state === 'finalized',
      }) || can(authorization, 'roster:write', { organizationId, tryoutId, divisionId })
    );
  }
  if (segments[5] === 'check-in') {
    const { data: sessions, error } = await client
      .from('tryout_sessions')
      .select('id,division_id,session_groups!session_groups_session_fkey(id)')
      .eq('organization_id', organizationId)
      .eq('tryout_id', tryoutId);
    if (error) throw error;
    // Authorized managers retain the existing empty-configuration UI.
    if (can(authorization, 'checkin:read', { organizationId, tryoutId })) return true;
    return !!sessions?.some((session) =>
      session.session_groups.length === 0
        ? can(authorization, 'checkin:read', {
            organizationId,
            tryoutId,
            sessionId: session.id,
            divisionId: session.division_id,
          })
        : session.session_groups.some((group) =>
            can(authorization, 'checkin:read', {
              organizationId,
              tryoutId,
              sessionId: session.id,
              divisionId: session.division_id,
              groupId: group.id,
            }),
          ),
    );
  }
  return true;
}
