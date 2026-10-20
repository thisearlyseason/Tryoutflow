import { createServerSupabaseClient } from '../../../../../infrastructure/supabase/server';
import { parseOrganizationId, parseUserId } from '../../../../../lib/ids';
import { SupabaseMembershipRepository } from '../../../../../modules/organizations/infrastructure/membership-repository';
import { createReportExport } from '../../../../../modules/reports/application/create-report-export';
import { SupabaseReportGateway } from '../../../../../modules/reports/infrastructure/supabase-report-gateway';

export async function createExportRouteDependencies() {
  const client = await createServerSupabaseClient();
  return {
    async authorize(organizationId: string) {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) return null;
      try {
        return await new SupabaseMembershipRepository(client).findAuthorizationContext(
          parseUserId(user.id),
          parseOrganizationId(organizationId),
        );
      } catch {
        return null;
      }
    },
    execute(
      input: Parameters<typeof createReportExport>[0],
      actor: Parameters<typeof createReportExport>[1],
      signal: AbortSignal,
    ) {
      return createReportExport(input, actor, new SupabaseReportGateway(client), signal);
    },
  };
}
