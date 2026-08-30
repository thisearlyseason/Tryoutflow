import type { EmailProvider, EmailProviderError } from '../email/email-provider';
import type { ClaimedEmailJob, JobRpcClient } from './claim-jobs';

export async function dispatchJob(
  client: JobRpcClient,
  provider: EmailProvider,
  job: ClaimedEmailJob,
  timing: { monotonicNow?: () => number } = {},
): Promise<'completed' | 'retry_scheduled' | 'dead_lettered' | 'cancelled' | 'needs_attention'> {
  const providerTimeoutMilliseconds = 45_000;
  const safetyMarginMilliseconds = 15_000;
  const processingMarginMilliseconds = 250;
  const monotonicNow = timing.monotonicNow ?? (() => performance.now());
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let sendAttemptToken: string | undefined;
  try {
    const authorizationStarted = monotonicNow();
    const authorization = await client.rpc('authorize_outbox_job_send_v2', {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_lease_generation: job.leaseGeneration,
      p_provider_timeout_ms: providerTimeoutMilliseconds,
      p_safety_margin_ms: safetyMarginMilliseconds,
    });
    const authorizationElapsed = Math.max(0, monotonicNow() - authorizationStarted);
    if (authorization.error) throw new Error('authorization_failed');
    const authorizationResult = asAuthorizationResult(authorization.data);
    if (authorizationResult.outcome === 'cancelled') return 'cancelled';
    if (
      ['needs_attention', 'in_progress', 'already_authorized'].includes(authorizationResult.outcome)
    )
      return 'needs_attention';
    if (authorizationResult.outcome === 'insufficient_budget') return 'retry_scheduled';
    if (
      authorizationResult.outcome !== 'authorized' ||
      !authorizationResult.sendAttemptToken ||
      authorizationResult.sendBudgetMilliseconds <= 0
    )
      throw new Error('authorization_conflict');
    sendAttemptToken = authorizationResult.sendAttemptToken;
    const remaining = Math.floor(
      authorizationResult.sendBudgetMilliseconds -
        authorizationElapsed -
        processingMarginMilliseconds,
    );
    if (!Number.isFinite(remaining) || remaining < 1) {
      const declined = await client.rpc('decline_outbox_job_send_v2', {
        p_job_id: job.jobId,
        p_lease_token: job.leaseToken,
        p_lease_generation: job.leaseGeneration,
        p_send_attempt_token: sendAttemptToken,
        p_reason: 'provider_deadline_elapsed',
      });
      if (declined.error || String(declined.data) !== 'retry_scheduled')
        throw new Error('authorization_conflict');
      return 'retry_scheduled';
    }
    const controller = new AbortController();
    timeout = setTimeout(
      () => controller.abort(),
      Math.min(providerTimeoutMilliseconds, remaining),
    );
    const result = await provider.send(
      { to: job.recipientEmail, subject: job.subject, text: job.bodyText },
      job.providerIdempotencyKey,
      { signal: controller.signal },
    );
    const completion = await client.rpc('complete_outbox_job_v2', {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_lease_generation: job.leaseGeneration,
      p_send_attempt_token: sendAttemptToken,
      p_provider_message_id: result.providerMessageId,
    });
    if (completion.error || !['completed', 'replayed'].includes(String(completion.data)))
      throw new Error('completion_failed');
    return 'completed';
  } catch (error) {
    if (
      error instanceof Error &&
      ['completion_failed', 'authorization_failed', 'authorization_conflict'].includes(
        error.message,
      )
    )
      throw error;
    const normalized = normalizeDispatchError(error);
    if (!sendAttemptToken) throw new Error('authorization_conflict');
    const failure = await client.rpc('fail_outbox_job_v2', {
      p_job_id: job.jobId,
      p_lease_token: job.leaseToken,
      p_lease_generation: job.leaseGeneration,
      p_send_attempt_token: sendAttemptToken,
      p_error_code: normalized.code,
      p_retryable: normalized.retryable,
    });
    if (failure.error) throw new Error('failure_record_failed');
    const outcome = String(failure.data);
    if (
      outcome === 'retry_scheduled' ||
      outcome === 'dead_lettered' ||
      outcome === 'needs_attention'
    )
      return outcome;
    if (outcome === 'replayed') return 'dead_lettered';
    throw new Error('failure_record_conflict');
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeDispatchError(error: unknown): EmailProviderError {
  if (error instanceof DOMException && error.name === 'AbortError')
    return { code: 'provider_timeout_uncertain', retryable: false };
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

function asAuthorizationResult(value: unknown): {
  outcome: string;
  sendAttemptToken?: string;
  sendBudgetMilliseconds: number;
} {
  if (typeof value !== 'object' || value === null)
    return { outcome: '', sendBudgetMilliseconds: 0 };
  const result = value as Record<string, unknown>;
  return {
    outcome: String(result.outcome ?? ''),
    sendAttemptToken:
      typeof result.send_attempt_token === 'string' ? result.send_attempt_token : undefined,
    sendBudgetMilliseconds: Number(result.send_budget_ms ?? 0),
  };
}
