export interface ReaperRetry {
  attempt: number;
  delayMilliseconds: number;
  exhausted: boolean;
}

export interface ReaperRetryPolicy {
  next(): ReaperRetry;
}

export function createReaperRetryPolicy(options?: {
  maximumAttempts?: number;
  initialDelayMilliseconds?: number;
  maximumDelayMilliseconds?: number;
}): ReaperRetryPolicy;
