import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import {
  handleHealthRequest,
  type DetailedHealth,
} from '../../../modules/observability/application/health-check';

export const dynamic = 'force-dynamic';

function nonnegativeCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export async function GET() {
  const client = await createServerSupabaseClient();
  return handleHealthRequest({
    async readCoarse() {
      const result = await client.rpc('public_health_check');
      if (result.error || result.data?.[0]?.status !== 'ok') throw new Error('health unavailable');
      return 'ok';
    },
    async readDetailed(): Promise<DetailedHealth | null> {
      const result = await client.rpc('platform_health');
      if (result.error || !result.data?.[0]) return null;
      const row = result.data[0];
      const failedJobs = nonnegativeCount(row.failed_jobs);
      const webhookFailures = nonnegativeCount(row.webhook_failures);
      const communicationFailures = nonnegativeCount(row.communication_failures);
      const integrationFailures = nonnegativeCount(row.integration_failures);
      const synchronizationProblems = nonnegativeCount(row.synchronization_problems);
      if (
        row.database_status !== 'ok' ||
        failedJobs === null ||
        webhookFailures === null ||
        communicationFailures === null ||
        integrationFailures === null ||
        synchronizationProblems === null
      ) {
        return null;
      }
      return {
        database: 'ok',
        failedJobs,
        webhookFailures,
        communicationFailures,
        integrationFailures,
        synchronizationProblems,
      };
    },
  });
}
