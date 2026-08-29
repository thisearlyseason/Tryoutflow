import { z } from 'zod';

import {
  evaluationMutationReceiptSchema,
  type EvaluationMutationReceipt,
} from '../application/evaluation-mutation-contract';
import type {
  EvaluationStorageScope,
  EvaluationStoredFailureCategory,
  StoredEvaluationMutation,
} from './database';
import { scopeKey } from './database';
import type { EvaluationOfflineRepository } from './repository';

type SynchronizerRepository = Pick<
  EvaluationOfflineRepository,
  'nextPendingMutation' | 'acknowledgeMutation' | 'markNeedsAttention' | 'recordMutationFailure'
>;
export type EvaluationMutationSender = (
  entry: StoredEvaluationMutation,
) => Promise<EvaluationMutationReceipt>;
export type EvaluationSynchronizerEvent = {
  scopeKey: string;
  evaluationId: string;
  clientMutationId: string;
  state: 'saved_device' | 'synced' | 'needs_attention';
  category?: EvaluationStoredFailureCategory;
};
export type EvaluationSynchronizerOptions = {
  repository: SynchronizerRepository;
  scope: EvaluationStorageScope;
  send: EvaluationMutationSender;
  online?: () => boolean;
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (timer: unknown) => void;
};
export type EvaluationMutationSendErrorCategory =
  'forbidden' | 'conflict' | 'invalid_input' | 'rate_limited' | 'transient';

export class EvaluationMutationSendError extends Error {
  override readonly name = 'EvaluationMutationSendError';
  constructor(
    readonly category: EvaluationMutationSendErrorCategory,
    message: string,
  ) {
    super(message);
  }
}

const attentionCategory = {
  conflict: 'conflict',
  forbidden: 'forbidden',
  invalid_context: 'invalid_rubric',
  invalid_score: 'invalid_rubric',
  invalid_note_tag: 'invalid_rubric',
  invalid_rubric: 'invalid_rubric',
  locked: 'conflict',
} as const;

export class EvaluationSynchronizer {
  private running = false;
  private hasStarted = false;
  private generation = 0;
  private flushing: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private readonly subscribers = new Set<(event: EvaluationSynchronizerEvent) => void>();
  private readonly onlineListener = () => void this.flush();

  constructor(private readonly options: EvaluationSynchronizerOptions) {}

  subscribe(listener: (event: EvaluationSynchronizerEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.hasStarted = true;
    this.generation += 1;
    const generation = this.generation;
    this.options.eventTarget?.addEventListener('online', this.onlineListener);
    if (this.flushing) {
      void this.flushing.finally(() => {
        if (this.isActive(generation)) void this.flush();
      });
    } else void this.flush();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    this.options.eventTarget?.removeEventListener('online', this.onlineListener);
    this.clearRetryTimer();
    this.subscribers.clear();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.running && this.hasStarted) return Promise.resolve();
    if (this.options.online && !this.options.online()) return Promise.resolve();
    const generation = this.running ? this.generation : null;
    const operation = this.drain(generation);
    const wrapped = operation.finally(() => {
      if (this.flushing === wrapped) this.flushing = null;
    });
    this.flushing = wrapped;
    return wrapped;
  }

  private async drain(generation: number | null): Promise<void> {
    for (;;) {
      if (generation !== null && !this.isActive(generation)) return;
      if (this.options.online && !this.options.online()) return;
      const entry = await this.options.repository.nextPendingMutation(this.options.scope, {
        now: this.now(),
      });
      if (!entry || (generation !== null && !this.isActive(generation))) return;
      let receipt: EvaluationMutationReceipt;
      try {
        receipt = await this.options.send(entry);
      } catch (error) {
        if (this.fenceStaleGeneration(entry, generation)) return;
        if (
          error instanceof EvaluationMutationSendError &&
          ['forbidden', 'conflict', 'invalid_input'].includes(error.category)
        ) {
          const category =
            error.category === 'forbidden'
              ? 'forbidden'
              : error.category === 'conflict'
                ? 'conflict'
                : 'invalid_input';
          await this.attention(entry, category, 'Evaluation synchronization requires review.');
          continue;
        }
        const failed = await this.options.repository.recordMutationFailure({
          scope: entry.scope,
          evaluationId: entry.evaluationId,
          clientMutationId: entry.clientMutationId,
          claimToken: entry.claimToken!,
          category:
            error instanceof EvaluationMutationSendError && error.category === 'rate_limited'
              ? 'server'
              : 'network',
          message: 'The synchronization request was not confirmed.',
          now: this.now(),
        });
        this.emitMutation(failed);
        if (failed.status === 'pending') this.scheduleRetry(failed.nextAttemptAt, generation);
        return;
      }
      if (this.fenceStaleGeneration(entry, generation)) return;
      if (
        receipt.clientMutationId !== entry.clientMutationId ||
        receipt.evaluationId !== entry.evaluationId ||
        receipt.expectedVersion !== entry.expectedVersion ||
        receipt.payloadDigest !== entry.payloadDigest
      ) {
        await this.attention(entry, 'corrupt_record', 'Server receipt did not match queued work.');
        continue;
      }
      if (receipt.outcome !== 'synced') {
        await this.attention(
          entry,
          attentionCategory[receipt.outcome],
          `Evaluation synchronization requires review (${receipt.outcome}).`,
        );
        continue;
      }
      if (receipt.serverVersion !== entry.expectedVersion + 1) {
        await this.attention(
          entry,
          'corrupt_record',
          'Server version was not the exact successor.',
        );
        continue;
      }
      try {
        await this.options.repository.acknowledgeMutation({
          scope: entry.scope,
          evaluationId: entry.evaluationId,
          clientMutationId: entry.clientMutationId,
          claimToken: entry.claimToken!,
          expectedVersion: entry.expectedVersion,
          payloadDigest: entry.payloadDigest,
          serverVersion: receipt.serverVersion,
          acknowledgedAt: receipt.acknowledgedAt,
        });
      } catch (error) {
        this.emit({
          scopeKey: entry.scopeKey,
          evaluationId: entry.evaluationId,
          clientMutationId: entry.clientMutationId,
          state: 'needs_attention',
          category: 'corrupt_record',
        });
        throw error;
      }
      this.emit({
        scopeKey: scopeKey(entry.scope),
        evaluationId: entry.evaluationId,
        clientMutationId: entry.clientMutationId,
        state: 'synced',
      });
    }
  }

  private isActive(generation: number): boolean {
    return this.running && this.generation === generation;
  }
  private fenceStaleGeneration(
    entry: StoredEvaluationMutation,
    generation: number | null,
  ): boolean {
    if (generation === null || this.isActive(generation)) return false;
    if (this.running && entry.leaseUntil) this.scheduleRetry(entry.leaseUntil, this.generation);
    return true;
  }
  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    (this.options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)))(
      this.retryTimer,
    );
    this.retryTimer = null;
  }
  private scheduleRetry(nextAttemptAt: string, generation: number | null): void {
    if (!this.running || generation === null || !this.isActive(generation)) return;
    this.clearRetryTimer();
    const delay = Math.max(0, new Date(nextAttemptAt).getTime() - this.now().getTime());
    const schedule =
      this.options.schedule ??
      ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
    this.retryTimer = schedule(() => {
      if (!this.isActive(generation)) return;
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }
  private async attention(
    entry: StoredEvaluationMutation,
    category: 'conflict' | 'forbidden' | 'invalid_input' | 'invalid_rubric' | 'corrupt_record',
    message: string,
  ): Promise<void> {
    const updated = await this.options.repository.markNeedsAttention({
      scope: entry.scope,
      evaluationId: entry.evaluationId,
      clientMutationId: entry.clientMutationId,
      claimToken: entry.claimToken!,
      category,
      message,
    });
    this.emitMutation(updated);
  }
  private emitMutation(entry: StoredEvaluationMutation): void {
    this.emit({
      scopeKey: entry.scopeKey,
      evaluationId: entry.evaluationId,
      clientMutationId: entry.clientMutationId,
      state: entry.status === 'needs_attention' ? 'needs_attention' : 'saved_device',
      ...(entry.errorCategory ? { category: entry.errorCategory } : {}),
    });
  }
  private emit(event: EvaluationSynchronizerEvent): void {
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(event);
      } catch {
        /* subscribers cannot affect durable state */
      }
    }
  }
}

const errorBodySchema = z.strictObject({
  error: z.enum([
    'unauthorized',
    'forbidden',
    'mutation_id_conflict',
    'invalid_input',
    'invalid_request',
    'rate_limited',
    'temporarily_unavailable',
  ]),
});

async function parseBoundedError(response: Response): Promise<z.infer<typeof errorBodySchema>> {
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const announced = Number(response.headers.get('content-length') ?? '0');
  if (type !== 'application/json' || (announced && announced > 4_096))
    throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 4_096)
    throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
  try {
    return errorBodySchema.parse(JSON.parse(text) as unknown);
  } catch {
    throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
  }
}

export function createEvaluationMutationSender(
  fetcher: typeof fetch = fetch,
): EvaluationMutationSender {
  return async (entry) => {
    let response: Response;
    try {
      response = await fetcher(`/api/evaluations/${entry.evaluationId}/mutations`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: entry.scope,
          clientMutationId: entry.clientMutationId,
          expectedVersion: entry.expectedVersion,
          draft: entry.draft,
        }),
      });
    } catch {
      throw new EvaluationMutationSendError('transient', 'sync_network_unconfirmed');
    }
    if (!response.ok) {
      const body = await parseBoundedError(response);
      if ((response.status === 401 && body.error === 'unauthorized') || response.status === 403)
        throw new EvaluationMutationSendError('forbidden', 'sync_forbidden');
      if (response.status === 409 && body.error === 'mutation_id_conflict')
        throw new EvaluationMutationSendError('conflict', 'sync_identity_conflict');
      if ([400, 413, 415].includes(response.status))
        throw new EvaluationMutationSendError('invalid_input', 'sync_invalid_input');
      if (response.status === 429 && body.error === 'rate_limited')
        throw new EvaluationMutationSendError('rate_limited', 'sync_rate_limited');
      if (response.status >= 500)
        throw new EvaluationMutationSendError('transient', 'sync_temporarily_unavailable');
      throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
    }
    if (!body || typeof body !== 'object' || !('receipt' in body))
      throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
    const parsed = evaluationMutationReceiptSchema.safeParse(
      (body as { receipt?: unknown }).receipt,
    );
    if (!parsed.success)
      throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
    return parsed.data;
  };
}
