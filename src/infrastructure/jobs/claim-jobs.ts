export type ClaimedEmailJob = Readonly<{
  jobId: string;
  messageId: string;
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  providerIdempotencyKey: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attemptCount: number;
  maxAttempts: number;
}>;

export type JobRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

export async function claimJobs(
  client: JobRpcClient,
  input: { leaseOwner: string; batchSize: number; leaseSeconds?: number },
): Promise<ClaimedEmailJob[]> {
  if (!/^[A-Za-z0-9:_-]{3,100}$/u.test(input.leaseOwner)) throw new Error('invalid_worker');
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 50)
    throw new Error('invalid_batch');
  const { data, error } = await client.rpc('claim_outbox_jobs', {
    p_lease_owner: input.leaseOwner,
    p_batch_size: input.batchSize,
    p_lease_seconds: input.leaseSeconds ?? 120,
  });
  if (error || !Array.isArray(data)) throw new Error('claim_failed');
  return data.map((row) => {
    const value = row as Record<string, unknown>;
    return {
      jobId: String(value.job_id),
      messageId: String(value.message_id),
      leaseToken: String(value.lease_token),
      leaseGeneration: Number(value.lease_generation),
      leaseExpiresAt: String(value.lease_expires_at),
      providerIdempotencyKey: String(value.provider_idempotency_key),
      recipientEmail: String(value.recipient_email),
      subject: String(value.subject),
      bodyText: String(value.body_text),
      bodyHtml: typeof value.body_html === 'string' ? value.body_html : undefined,
      attemptCount: Number(value.attempt_count),
      maxAttempts: Number(value.max_attempts),
    };
  });
}
