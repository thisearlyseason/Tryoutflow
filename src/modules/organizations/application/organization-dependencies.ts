import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { SupabaseOrganizationGateway } from '../infrastructure/supabase-organization-gateway';
import type { OrganizationGateway } from '../domain/organization';

export async function defaultOrganizationGateway(): Promise<OrganizationGateway> {
  return new SupabaseOrganizationGateway(await createServerSupabaseClient());
}
