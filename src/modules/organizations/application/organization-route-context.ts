import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../infrastructure/supabase/database.types';
import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import {
  parseOrganizationId,
  parseUserId,
  type OrganizationId,
  type UserId,
} from '../../../lib/ids';
import type { AuthorizationContext } from './capabilities';
import { loadOrganizationLogoUrl } from './current-organization';
import { SupabaseMembershipRepository } from '../infrastructure/membership-repository';

export type OrganizationShell = {
  id: OrganizationId;
  name: string;
  slug: string;
  logoUrl?: string;
};

export type OrganizationRouteContextGateway = {
  findOrganizationContext?(
    userId: UserId,
    slug: string,
  ): Promise<{ organization: OrganizationShell; authorization: AuthorizationContext } | null>;
  findOrganizationShellBySlug(slug: string): Promise<OrganizationShell | null>;
  loadOrganizationLogoUrl?(organization: OrganizationShell): Promise<string | undefined>;
  findAuthorizationContext(
    userId: UserId,
    organizationId: OrganizationId,
  ): Promise<AuthorizationContext | null>;
};

export async function resolveOrganizationRouteContext(
  slug: string,
  userId: UserId,
  gateway: OrganizationRouteContextGateway,
) {
  if (gateway.findOrganizationContext) {
    const context = await gateway.findOrganizationContext(userId, slug);
    if (
      !context ||
      context.authorization.organizationId !== context.organization.id ||
      context.authorization.userId !== userId
    )
      return null;
    const logoUrl = await gateway.loadOrganizationLogoUrl?.(context.organization);
    return {
      organization: { ...context.organization, ...(logoUrl ? { logoUrl } : {}) },
      authorization: context.authorization,
      userId,
    };
  }
  const organization = await gateway.findOrganizationShellBySlug(slug);
  if (!organization) return null;
  // Optional branding uses its own live membership check. Neither result is
  // exposed until the independent authorization has succeeded.
  const [authorization, logoUrl] = await Promise.all([
    gateway.findAuthorizationContext(userId, organization.id),
    gateway.loadOrganizationLogoUrl?.(organization),
  ]);
  if (!authorization || authorization.organizationId !== organization.id) return null;
  return {
    organization: { ...organization, ...(logoUrl ? { logoUrl } : {}) },
    authorization,
    userId,
  };
}

export function canManageTryoutStaffing(
  authorization: AuthorizationContext,
  tryoutId: string,
): boolean {
  if (
    authorization.organizationRole === 'owner' ||
    authorization.organizationRole === 'administrator'
  ) {
    return true;
  }
  return authorization.assignments.some(
    (assignment) => assignment.role === 'director' && assignment.scope.tryoutId === tryoutId,
  );
}

function serverGateway(client: SupabaseClient<Database>): OrganizationRouteContextGateway {
  return {
    async findOrganizationContext(userId, slug) {
      const context = await new SupabaseMembershipRepository(client).findOrganizationContext(
        userId,
        slug,
      );
      if (!context) return null;
      return {
        organization: {
          id: parseOrganizationId(context.organization.id),
          name: context.organization.name,
          slug: context.organization.slug,
        },
        authorization: context.authorization,
      };
    },
    async findOrganizationShellBySlug(slug) {
      const { data, error } = await client
        .from('organizations')
        .select('id,name,slug')
        .eq('slug', slug)
        .maybeSingle();
      if (error || !data) return null;
      return { id: parseOrganizationId(data.id), name: data.name, slug: data.slug };
    },
    findAuthorizationContext(userId, organizationId) {
      return new SupabaseMembershipRepository(client).findAuthorizationContext(
        userId,
        organizationId,
      );
    },
    loadOrganizationLogoUrl(organization) {
      return loadOrganizationLogoUrl(client, organization);
    },
  };
}

/** Loads only shell-safe organization fields plus live membership and assignment authority. */
// Deduplicate layout/page reads only within one server render; never cache authority across requests.
export const requireOrganizationRouteContext = cache(async (slug: string) => {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) notFound();
  const userId = parseUserId(user.id);
  const context = await resolveOrganizationRouteContext(slug, userId, serverGateway(client));
  if (!context) notFound();
  return {
    ...context,
    client,
  };
});
