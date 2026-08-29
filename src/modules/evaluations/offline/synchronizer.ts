import {
  evaluationMutationReceiptSchema,
  type EvaluationMutationReceipt,
} from '../application/evaluation-mutation-contract';
import type { EvaluationStorageScope, StoredEvaluationMutation } from './database';
import type { EvaluationOfflineRepository } from './repository';

type SynchronizerRepository = Pick<
  EvaluationOfflineRepository,
  'nextPendingMutation' | 'acknowledgeMutation' | 'markNeedsAttention' | 'recordMutationFailure'
>;

export type EvaluationMutationSender = (
  entry: StoredEvaluationMutation,
) => Promise<EvaluationMutationReceipt>;

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
  private flushing: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private readonly onlineListener = () => void this.flush();

  constructor(private readonly options: EvaluationSynchronizerOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.options.eventTarget?.addEventListener('online', this.onlineListener);
    void this.flush();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.options.eventTarget?.removeEventListener('online', this.onlineListener);
    if (this.retryTimer !== null) {
      (this.options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)))(
        this.retryTimer,
      );
      this.retryTimer = null;
    }
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.options.online && !this.options.online()) return Promise.resolve();
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (this.options.online && !this.options.online()) return;
      const entry = await this.options.repository.nextPendingMutation(this.options.scope, {
        now: this.now(),
      });
      if (!entry) return;
      let receipt: EvaluationMutationReceipt;
      try {
        receipt = await this.options.send(entry);
      } catch {
        const failed = await this.options.repository.recordMutationFailure({
          scope: entry.scope,
          evaluationId: entry.evaluationId,
          clientMutationId: entry.clientMutationId,
          claimToken: entry.claimToken!,
          category: 'network',
          message: 'The synchronization request was not confirmed.',
          now: this.now(),
        });
        this.scheduleRetry(failed.nextAttemptAt);
        return;
      }
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
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private scheduleRetry(nextAttemptAt: string): void {
    if (!this.running) return;
    if (this.retryTimer !== null) {
      (this.options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)))(
        this.retryTimer,
      );
    }
    const delay = Math.max(0, new Date(nextAttemptAt).getTime() - this.now().getTime());
    const schedule =
      this.options.schedule ??
      ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
    this.retryTimer = schedule(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private attention(
    entry: StoredEvaluationMutation,
    category: 'conflict' | 'forbidden' | 'invalid_rubric' | 'corrupt_record',
    message: string,
  ) {
    return this.options.repository.markNeedsAttention({
      scope: entry.scope,
      evaluationId: entry.evaluationId,
      clientMutationId: entry.clientMutationId,
      claimToken: entry.claimToken!,
      category,
      message,
    });
  }
}

export function createEvaluationMutationSender(
  fetcher: typeof fetch = fetch,
): EvaluationMutationSender {
  return async (entry) => {
    const response = await fetcher(`/api/evaluations/${entry.evaluationId}/mutations`, {
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
    if (!response.ok) throw new Error('sync_request_failed');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !(body instanceof Object) || !('receipt' in body))
      throw new Error('invalid_sync_response');
    const parsed = evaluationMutationReceiptSchema.safeParse(
      (body as { receipt?: unknown }).receipt,
    );
    if (!parsed.success) throw new Error('invalid_sync_response');
    return parsed.data;
  };
}
