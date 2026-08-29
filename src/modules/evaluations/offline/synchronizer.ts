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
  | 'databaseName'
  | 'nextPendingMutation'
  | 'acknowledgeMutation'
  | 'markNeedsAttention'
  | 'recordMutationFailure'
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
  origin?: 'remote' | 'poll';
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
  channelFactory?: (name: string) => EvaluationChangeChannel | null;
  poll?: (callback: () => void, delayMs: number) => unknown;
  cancelPoll?: (timer: unknown) => void;
  pollIntervalMs?: number;
  /** Test seam; production instances always use a fresh cryptographically random UUID. */
  sourceInstanceId?: string;
};
export type EvaluationChangeChannel = {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
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

const synchronizerEventSchema = z.strictObject({
  protocol: z.literal('tryoutflow-evaluation-change-v2'),
  userBinding: z.uuid(),
  sourceInstanceId: z.uuid(),
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  scopeKey: z.string().min(1).max(512),
  evaluationId: z.uuid(),
  clientMutationId: z.uuid(),
  state: z.enum(['saved_device', 'synced', 'needs_attention']),
});

export class EvaluationSynchronizer {
  private running = false;
  private hasStarted = false;
  private generation = 0;
  private flushing: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private changeChannel: EvaluationChangeChannel | null = null;
  private pollTimer: unknown = null;
  private readonly sourceInstanceId: string;
  private outgoingSequence = 0;
  private readonly receivedSequences = new Map<string, number>();
  private readonly subscribers = new Set<(event: EvaluationSynchronizerEvent) => void>();
  private readonly onlineListener = () => void this.flush();
  private readonly channelListener = (event: { data: unknown }) => {
    const parsed = synchronizerEventSchema.safeParse(event.data);
    if (
      !parsed.success ||
      parsed.data.userBinding !== this.options.scope.userId ||
      parsed.data.scopeKey !== scopeKey(this.options.scope) ||
      parsed.data.sourceInstanceId === this.sourceInstanceId
    )
      return;
    const previous = this.receivedSequences.get(parsed.data.sourceInstanceId) ?? 0;
    // A channel pulse is only accepted in exact order. Gaps are never trusted; the durable poll
    // below repairs genuinely dropped messages by causing a storage re-query.
    if (parsed.data.sequence !== previous + 1) return;
    if (
      !this.receivedSequences.has(parsed.data.sourceInstanceId) &&
      this.receivedSequences.size >= 64
    )
      return;
    this.receivedSequences.set(parsed.data.sourceInstanceId, parsed.data.sequence);
    const {
      protocol: _protocol,
      userBinding: _userBinding,
      sourceInstanceId: _sourceInstanceId,
      sequence: _sequence,
      ...change
    } = parsed.data;
    this.emitLocal({ ...change, origin: 'remote' });
  };

  constructor(private readonly options: EvaluationSynchronizerOptions) {
    this.sourceInstanceId = options.sourceInstanceId ?? crypto.randomUUID();
    if (!z.uuid().safeParse(this.sourceInstanceId).success)
      throw new TypeError('sourceInstanceId must be a UUID.');
  }

  subscribe(listener: (event: EvaluationSynchronizerEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Publish only a bounded re-query pulse after another durable local transaction commits. */
  signalDurableChange(event: EvaluationSynchronizerEvent): void {
    if (!this.running) return;
    this.broadcast(event);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.hasStarted = true;
    this.generation += 1;
    const generation = this.generation;
    this.openChangePropagation();
    this.options.eventTarget?.addEventListener('online', this.onlineListener);
    if (this.flushing) {
      this.scheduleRetry(new Date(this.now().getTime() + 30_000).toISOString(), generation);
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
    this.closeChangePropagation();
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
        if (this.fenceStaleGeneration(generation)) return;
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
          await this.attention(
            entry,
            category,
            'Evaluation synchronization requires review.',
            generation,
          );
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
        if (this.fenceStaleGeneration(generation)) return;
        this.emitMutation(failed);
        if (failed.status === 'pending') this.scheduleRetry(failed.nextAttemptAt, generation);
        return;
      }
      if (this.fenceStaleGeneration(generation)) return;
      if (
        receipt.clientMutationId !== entry.clientMutationId ||
        receipt.evaluationId !== entry.evaluationId ||
        receipt.expectedVersion !== entry.expectedVersion ||
        receipt.payloadDigest !== entry.payloadDigest
      ) {
        await this.attention(
          entry,
          'corrupt_record',
          'Server receipt did not match queued work.',
          generation,
        );
        continue;
      }
      if (receipt.outcome !== 'synced') {
        await this.attention(
          entry,
          attentionCategory[receipt.outcome],
          `Evaluation synchronization requires review (${receipt.outcome}).`,
          generation,
          receipt.outcome === 'conflict'
            ? {
                evaluationId: receipt.serverEvaluationId,
                version: receipt.serverVersion,
              }
            : undefined,
        );
        continue;
      }
      if (receipt.serverVersion !== entry.expectedVersion + 1) {
        await this.attention(
          entry,
          'corrupt_record',
          'Server version was not the exact successor.',
          generation,
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
        if (this.fenceStaleGeneration(generation)) throw error;
        this.emit({
          scopeKey: entry.scopeKey,
          evaluationId: entry.evaluationId,
          clientMutationId: entry.clientMutationId,
          state: 'needs_attention',
          category: 'corrupt_record',
        });
        throw error;
      }
      if (this.fenceStaleGeneration(generation)) return;
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
  private fenceStaleGeneration(generation: number | null): boolean {
    return generation !== null && !this.isActive(generation);
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
      if (this.flushing) {
        void this.flushing.finally(() => {
          if (this.isActive(generation)) void this.flush();
        });
      } else void this.flush();
    }, delay);
  }
  private async attention(
    entry: StoredEvaluationMutation,
    category: 'conflict' | 'forbidden' | 'invalid_input' | 'invalid_rubric' | 'corrupt_record',
    message: string,
    generation: number | null,
    conflictServer?: { evaluationId: string | null | undefined; version: number | null },
  ): Promise<void> {
    const updated = await this.options.repository.markNeedsAttention({
      scope: entry.scope,
      evaluationId: entry.evaluationId,
      clientMutationId: entry.clientMutationId,
      claimToken: entry.claimToken!,
      category,
      message,
      ...(conflictServer?.evaluationId && conflictServer.version !== null
        ? {
            conflictServerEvaluationId: conflictServer.evaluationId,
            conflictServerVersion: conflictServer.version,
          }
        : {}),
    });
    if (this.fenceStaleGeneration(generation)) return;
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
    this.emitLocal(event);
    this.broadcast(event);
  }
  private broadcast(event: EvaluationSynchronizerEvent): void {
    if (!this.changeChannel) return;
    try {
      if (this.outgoingSequence >= Number.MAX_SAFE_INTEGER) return;
      this.outgoingSequence += 1;
      this.changeChannel.postMessage({
        protocol: 'tryoutflow-evaluation-change-v2',
        userBinding: this.options.scope.userId,
        sourceInstanceId: this.sourceInstanceId,
        sequence: this.outgoingSequence,
        scopeKey: event.scopeKey,
        evaluationId: event.evaluationId,
        clientMutationId: event.clientMutationId,
        state: event.state,
      });
    } catch {
      // Cross-tab observability cannot redefine the already-committed durable state.
    }
  }
  private emitLocal(event: EvaluationSynchronizerEvent): void {
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(event);
      } catch {
        /* subscribers cannot affect durable state */
      }
    }
  }

  private openChangePropagation(): void {
    this.closeChangePropagation();
    const factory =
      this.options.channelFactory ??
      (typeof globalThis.BroadcastChannel === 'undefined'
        ? null
        : (name: string) => new globalThis.BroadcastChannel(name));
    try {
      this.changeChannel =
        factory?.(`tryoutflow-evaluation-sync-v1:${this.options.repository.databaseName}`) ?? null;
      this.changeChannel?.addEventListener('message', this.channelListener);
    } catch {
      try {
        this.changeChannel?.close();
      } catch {
        // Fall through to deterministic polling when a partial channel cannot be closed.
      }
      this.changeChannel = null;
    }
    const poll =
      this.options.poll ??
      ((callback: () => void, delayMs: number) => globalThis.setInterval(callback, delayMs));
    this.pollTimer = poll(() => {
      if (!this.running) return;
      this.emitLocal({
        scopeKey: scopeKey(this.options.scope),
        evaluationId: '00000000-0000-4000-8000-000000000000',
        clientMutationId: '00000000-0000-4000-8000-000000000000',
        state: 'saved_device',
        origin: 'poll',
      });
    }, this.options.pollIntervalMs ?? 1_000);
  }

  private closeChangePropagation(): void {
    if (this.changeChannel) {
      try {
        this.changeChannel.removeEventListener('message', this.channelListener);
      } catch {
        // Listener removal is best-effort; closing below still fences future delivery.
      }
      try {
        this.changeChannel.close();
      } catch {
        // Closing a browser primitive is best-effort and contains no durable transition.
      }
      this.changeChannel = null;
    }
    if (this.pollTimer !== null) {
      const cancel =
        this.options.cancelPoll ?? ((timer: unknown) => globalThis.clearInterval(timer as number));
      cancel(this.pollTimer);
      this.pollTimer = null;
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
const successBodySchema = z.strictObject({ receipt: evaluationMutationReceiptSchema });

async function parseBoundedError(response: Response): Promise<z.infer<typeof errorBodySchema>> {
  try {
    return errorBodySchema.parse(await readJsonResponseEnvelope(response, 4_096));
  } catch (error) {
    if (error instanceof EvaluationMutationSendError) throw error;
    throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
  }
}

export async function readJsonResponseEnvelope(response: Response, maximumBytes: number) {
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  const announcedRaw = response.headers.get('content-length');
  const announced = announcedRaw === null ? null : Number(announcedRaw);
  if (
    type !== 'application/json' ||
    (announced !== null &&
      (!Number.isSafeInteger(announced) || announced < 0 || announced > maximumBytes)) ||
    !response.body
  )
    throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('response_too_large');
        throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    try {
      await reader.cancel('invalid_response');
    } catch {
      // Cancellation is best-effort and never changes the response classification.
    }
    if (error instanceof EvaluationMutationSendError) throw error;
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
    const body = await readJsonResponseEnvelope(response, 64 * 1_024);
    const parsed = successBodySchema.safeParse(body);
    if (!parsed.success)
      throw new EvaluationMutationSendError('transient', 'sync_response_invalid');
    return parsed.data.receipt;
  };
}
