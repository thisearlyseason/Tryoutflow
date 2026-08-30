import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import type {
  ClaimedIntegrationJob,
  IntegrationDispatchOutcome,
} from '../../../../infrastructure/integrations/dispatch-integration-job';
import type { ClaimedEmailJob } from '../../../../infrastructure/jobs/claim-jobs';

const MAX_BODY_BYTES = 1_024;
const bodySchema = z.object({ batchSize: z.number().int().min(1).max(50).default(10) }).strict();

type ProcessDependencies = {
  secret: string;
  purgeExpiredPreviews?(): Promise<void>;
  purgeExpiredCheckoutIntents?(): Promise<void>;
  claim(input: {
    leaseOwner: string;
    batchSize: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailJob[]>;
  dispatch(
    job: ClaimedEmailJob,
  ): Promise<'completed' | 'retry_scheduled' | 'dead_lettered' | 'cancelled' | 'needs_attention'>;
  claimIntegrations?(input: {
    leaseOwner: string;
    batchSize: number;
    leaseSeconds: number;
  }): Promise<ClaimedIntegrationJob[]>;
  dispatchIntegration?(job: ClaimedIntegrationJob): Promise<IntegrationDispatchOutcome>;
};

type JobSummary = {
  claimed: number;
  completed: number;
  retryScheduled: number;
  deadLettered: number;
  cancelled: number;
  needsAttention: number;
  failed: number;
};

function emptySummary(claimed: number): JobSummary {
  return {
    claimed,
    completed: 0,
    retryScheduled: 0,
    deadLettered: 0,
    cancelled: 0,
    needsAttention: 0,
    failed: 0,
  };
}

function recordOutcome(summary: JobSummary, outcome: IntegrationDispatchOutcome) {
  if (outcome === 'completed') summary.completed += 1;
  else if (outcome === 'retry_scheduled') summary.retryScheduled += 1;
  else if (outcome === 'dead_lettered') summary.deadLettered += 1;
  else if (outcome === 'cancelled') summary.cancelled += 1;
  else summary.needsAttention += 1;
}

function jsonError(status: number, code: string) {
  return NextResponse.json({ error: code }, { status });
}

function secretMatches(header: string | null, secret: string): boolean {
  const candidate = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const expectedDigest = createHash('sha256').update(secret).digest();
  const candidateDigest = createHash('sha256').update(candidate).digest();
  return candidate.length > 0 && timingSafeEqual(expectedDigest, candidateDigest);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const announced = request.headers.get('content-length');
  if (announced !== null) {
    const length = Number(announced);
    if (!Number.isSafeInteger(length) || length < 0) throw { status: 400 };
    if (length > MAX_BODY_BYTES) throw { status: 413 };
  }
  if (!request.body) throw { status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw { status: 413 };
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw { status: 400 };
  }
}

export async function processJobsRequest(request: Request, dependencies: ProcessDependencies) {
  if (request.method !== 'POST') return jsonError(405, 'method_not_allowed');
  if (!secretMatches(request.headers.get('authorization'), dependencies.secret))
    return jsonError(401, 'unauthorized');
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) return jsonError(403, 'forbidden');
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  )
    return jsonError(415, 'unsupported_media_type');
  try {
    const parsed = bodySchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) return jsonError(400, 'invalid_request');
    await dependencies.purgeExpiredPreviews?.().catch(() => undefined);
    await dependencies.purgeExpiredCheckoutIntents?.().catch(() => undefined);
    const leaseRunId = randomUUID();
    const claimInput = {
      leaseOwner: `vercel:${leaseRunId}`,
      batchSize: parsed.data.batchSize,
      leaseSeconds: 90,
    };
    const [jobs, integrationJobs] = await Promise.all([
      dependencies.claim(claimInput),
      dependencies.claimIntegrations?.({
        ...claimInput,
        leaseOwner: `vercel:integration:${leaseRunId}`,
      }) ?? Promise.resolve([]),
    ]);
    const summary = emptySummary(jobs.length);
    const integrationSummary = emptySummary(integrationJobs.length);
    await Promise.all(
      jobs.map(async (job) => {
        try {
          const outcome = await dependencies.dispatch(job);
          recordOutcome(summary, outcome);
        } catch {
          summary.failed += 1;
        }
      }),
    );
    const dispatchIntegration = dependencies.dispatchIntegration;
    if (dispatchIntegration) {
      await Promise.all(
        integrationJobs.map(async (job) => {
          try {
            recordOutcome(integrationSummary, await dispatchIntegration(job));
          } catch {
            integrationSummary.failed += 1;
          }
        }),
      );
    }
    return NextResponse.json(
      dependencies.claimIntegrations ? { ...summary, integrations: integrationSummary } : summary,
    );
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status: unknown }).status)
        : 503;
    return [400, 413].includes(status)
      ? jsonError(status, status === 413 ? 'request_too_large' : 'invalid_request')
      : jsonError(503, 'temporarily_unavailable');
  }
}

export async function POST(request: Request) {
  const [
    { createAdminSupabaseClient },
    { getCommunicationEnvironment },
    { claimJobs },
    { dispatchJob },
    { ResendEmailProvider },
    { claimIntegrationJobs, SupabaseIntegrationDispatchGateway },
    { dispatchIntegrationJob },
    { getServerTeamManagementProviderRegistry },
  ] = await Promise.all([
    import('../../../../infrastructure/supabase/admin'),
    import('../../../../lib/env'),
    import('../../../../infrastructure/jobs/claim-jobs'),
    import('../../../../infrastructure/jobs/dispatch-job'),
    import('../../../../infrastructure/email/resend-provider'),
    import('../../../../infrastructure/integrations/integration-outbox'),
    import('../../../../infrastructure/integrations/dispatch-integration-job'),
    import('../../../../infrastructure/integrations/server-provider-registry'),
  ]);
  const environment = getCommunicationEnvironment();
  const client = createAdminSupabaseClient();
  const provider = new ResendEmailProvider({
    apiKey: environment.RESEND_API_KEY,
    from: environment.RESEND_FROM_EMAIL,
  });
  return processJobsRequest(request, {
    secret: environment.JOB_PROCESSOR_CRON_SECRET,
    purgeExpiredPreviews: async () => {
      const { error } = await client.rpc('purge_expired_communication_previews', { p_limit: 100 });
      if (error) throw new Error('preview_purge_failed');
    },
    purgeExpiredCheckoutIntents: async () => {
      const { error } = await client.rpc('purge_expired_subscription_checkout_intents', {
        p_limit: 100,
      });
      if (error) throw new Error('checkout_intent_purge_failed');
    },
    claim: (input) => claimJobs(client, input),
    dispatch: (job) => dispatchJob(client, provider, job),
    claimIntegrations: (input) => claimIntegrationJobs(client, input),
    dispatchIntegration: (job) =>
      dispatchIntegrationJob(job, {
        providers: getServerTeamManagementProviderRegistry(),
        gateway: new SupabaseIntegrationDispatchGateway(client),
      }),
  });
}
