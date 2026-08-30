import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { ClaimedEmailJob } from '../../../../infrastructure/jobs/claim-jobs';

const MAX_BODY_BYTES = 1_024;
const bodySchema = z.object({ batchSize: z.number().int().min(1).max(50).default(10) }).strict();

type ProcessDependencies = {
  secret: string;
  claim(input: {
    leaseOwner: string;
    batchSize: number;
    leaseSeconds: number;
  }): Promise<ClaimedEmailJob[]>;
  dispatch(job: ClaimedEmailJob): Promise<'completed' | 'retry_scheduled' | 'dead_lettered'>;
};

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
    const jobs = await dependencies.claim({
      leaseOwner: `vercel:${randomUUID()}`,
      batchSize: parsed.data.batchSize,
      leaseSeconds: 120,
    });
    const summary = {
      claimed: jobs.length,
      completed: 0,
      retryScheduled: 0,
      deadLettered: 0,
      failed: 0,
    };
    for (const job of jobs) {
      try {
        const outcome = await dependencies.dispatch(job);
        if (outcome === 'completed') summary.completed += 1;
        else if (outcome === 'retry_scheduled') summary.retryScheduled += 1;
        else summary.deadLettered += 1;
      } catch {
        summary.failed += 1;
      }
    }
    return NextResponse.json(summary);
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
  ] = await Promise.all([
    import('../../../../infrastructure/supabase/admin'),
    import('../../../../lib/env'),
    import('../../../../infrastructure/jobs/claim-jobs'),
    import('../../../../infrastructure/jobs/dispatch-job'),
    import('../../../../infrastructure/email/resend-provider'),
  ]);
  const environment = getCommunicationEnvironment();
  const client = createAdminSupabaseClient();
  const provider = new ResendEmailProvider({
    apiKey: environment.RESEND_API_KEY,
    from: environment.RESEND_FROM_EMAIL,
  });
  return processJobsRequest(request, {
    secret: environment.JOB_PROCESSOR_CRON_SECRET,
    claim: (input) => claimJobs(client, input),
    dispatch: (job) => dispatchJob(client, provider, job),
  });
}
