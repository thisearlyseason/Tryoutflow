import type { EmailProvider, EmailProviderError } from '../email/email-provider';
import type { ClaimedEmailJob, JobRpcClient } from './claim-jobs';

export async function dispatchJob(
  client: JobRpcClient,
  provider: EmailProvider,
  job: ClaimedEmailJob,
): Promise<'completed' | 'retry_scheduled' | 'dead_lettered'> {
  try {
    const result = await provider.send(
      { to: job.recipientEmail, subject: job.subject, text: job.bodyText },
      job.providerIdempotencyKey,
    );
    const completion = await client.rpc('complete_outbox_job', {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_lease_generation: job.leaseGeneration,
      p_provider_message_id: result.providerMessageId,
    });
    if (completion.error || !['completed', 'replayed'].includes(String(completion.data)))
      throw new Error('completion_failed');
    return 'completed';
  } catch (error) {
    if (error instanceof Error && error.message === 'completion_failed') throw error;
    const normalized = normalizeDispatchError(error);
    const failure = await client.rpc('fail_outbox_job', {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_lease_generation: job.leaseGeneration,
      p_error_code: normalized.code,
      p_retryable: normalized.retryable,
    });
    if (failure.error) throw new Error('failure_record_failed');
    const outcome = String(failure.data);
    if (outcome === 'retry_scheduled' || outcome === 'dead_lettered') return outcome;
    if (outcome === 'replayed') return 'dead_lettered';
    throw new Error('failure_record_conflict');
  }
}

function normalizeDispatchError(error: unknown): EmailProviderError {
  if (
    typeof error === 'object' &&
    error !== null &&
    ['provider_temporary', 'provider_rejected', 'provider_configuration'].includes(
      String((error as { code?: unknown }).code),
    ) &&
    typeof (error as { retryable?: unknown }).retryable === 'boolean'
  ) {
    return error as EmailProviderError;
  }
  return { code: 'provider_temporary', retryable: true };
}
