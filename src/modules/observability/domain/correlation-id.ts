import 'server-only';

import { randomUUID } from 'node:crypto';

declare const correlationIdBrand: unique symbol;

/** Opaque process-issued identifier. Runtime authenticity is retained in a private WeakMap. */
export type CorrelationId = Readonly<{ [correlationIdBrand]: true }>;

const issuedCorrelationIds = new WeakMap<object, string>();

export function createCorrelationId(): CorrelationId {
  const correlationId = Object.freeze({}) as CorrelationId;
  issuedCorrelationIds.set(correlationId, randomUUID());
  return correlationId;
}

export function correlationIdValue(value: unknown): string | null {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return null;
  return issuedCorrelationIds.get(value as object) ?? null;
}
