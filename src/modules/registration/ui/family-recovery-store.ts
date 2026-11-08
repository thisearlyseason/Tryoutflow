import { z } from 'zod';
export const FAMILY_KEY = 'tryoutflow.family-recovery.v1.copy';
export const FAMILY_EPOCH = 'tryoutflow.family-recovery.v1.privacy';
export const FAMILY_RESET = 'tryoutflow-family-recovery-reset';
export const FAMILY_TTL = 30 * 60 * 1000;
export type FamilyScope = { tryoutSlug: string; formVersionId: string; context: string };
export const familyLimits = {
  givenName: 160,
  familyName: 160,
  guardianName: 160,
  guardianEmail: 254,
  guardianPhone: 80,
  divisionId: 128,
  positionId: 128,
};
const scopeSchema = z
  .object({
    tryoutSlug: z.string().max(200),
    formVersionId: z.string().max(128),
    context: z.string().max(256),
  })
  .strict();
const recordSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    epoch: z.uuid(),
    scope: scopeSchema,
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    expiresAt: z.number().int(),
    revision: z.number().int().positive(),
    fields: z
      .object({
        givenName: z.string().max(160),
        familyName: z.string().max(160),
        guardianName: z.string().max(160),
        guardianEmail: z.string().max(254),
        guardianPhone: z.string().max(80),
        divisionId: z.string().max(128),
        positionId: z.string().max(128),
      })
      .strict(),
  })
  .strict();
export type FamilyRecord = z.infer<typeof recordSchema>;
export type FamilyRead =
  | { kind: 'candidate' | 'stale'; record: FamilyRecord }
  | { kind: 'none' | 'expired' | 'unavailable' };
export function familyEpoch(): string | null {
  try {
    let epoch = localStorage.getItem(FAMILY_EPOCH);
    if (!epoch || !z.uuid().safeParse(epoch).success) {
      epoch = crypto.randomUUID();
      localStorage.setItem(FAMILY_EPOCH, epoch);
    }
    return epoch;
  } catch {
    return null;
  }
}
export function invalidateFamilyTab() {
  try {
    sessionStorage.removeItem(FAMILY_KEY);
  } catch {
    /* Best effort when blocked. */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FAMILY_RESET));
}
export function clearFamilyRecovery() {
  try {
    localStorage.setItem(FAMILY_EPOCH, crypto.randomUUID());
  } catch {
    /* Current tab still resets. */
  }
  invalidateFamilyTab();
}
function readRecord(): FamilyRecord | null {
  const raw = sessionStorage.getItem(FAMILY_KEY);
  if (!raw) return null;
  if (raw.length > 5000) {
    sessionStorage.removeItem(FAMILY_KEY);
    return null;
  }
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* Invalid record. */
  }
  sessionStorage.removeItem(FAMILY_KEY);
  return null;
}
export function reconcileFamilyTab(now = Date.now()) {
  try {
    const record = readRecord();
    if (!record) return;
    const epoch = familyEpoch();
    if (!epoch || record.epoch !== epoch) {
      invalidateFamilyTab();
      return;
    }
    if (now >= record.expiresAt || record.expiresAt - record.createdAt !== FAMILY_TTL)
      sessionStorage.removeItem(FAMILY_KEY);
  } catch {
    /* Blocked storage remains unavailable. */
  }
}
export function readFamilyRecovery(scope: FamilyScope, now = Date.now()): FamilyRead {
  try {
    const epoch = familyEpoch();
    if (!epoch) return { kind: 'unavailable' };
    const record = readRecord();
    if (!record) return { kind: 'none' };
    if (
      record.epoch !== epoch ||
      record.scope.tryoutSlug !== scope.tryoutSlug ||
      record.scope.context !== scope.context ||
      record.expiresAt - record.createdAt !== FAMILY_TTL ||
      record.createdAt > now + 60000 ||
      record.updatedAt < record.createdAt ||
      record.updatedAt >= record.expiresAt
    ) {
      sessionStorage.removeItem(FAMILY_KEY);
      return { kind: 'none' };
    }
    if (now >= record.expiresAt) {
      sessionStorage.removeItem(FAMILY_KEY);
      return { kind: 'expired' };
    }
    return {
      kind: record.scope.formVersionId === scope.formVersionId ? 'candidate' : 'stale',
      record,
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
export function writeFamilyRecovery(
  scope: FamilyScope,
  values: Record<string, string>,
  expected: { epoch: string; id?: string; revision?: number },
  now = Date.now(),
):
  | { kind: 'saved'; record: FamilyRecord }
  | { kind: 'inactive' | 'conflict' | 'unavailable' | 'expired' } {
  try {
    const epoch = familyEpoch();
    if (!epoch) return { kind: 'unavailable' };
    if (epoch !== expected.epoch) return { kind: 'inactive' };
    const read = readFamilyRecovery(scope, now);
    if (read.kind === 'unavailable' || read.kind === 'expired') return { kind: read.kind };
    if (read.kind === 'stale') return { kind: 'conflict' };
    const previous = read.kind === 'candidate' ? read.record : undefined;
    if (previous?.id !== expected.id || previous?.revision !== expected.revision)
      return { kind: 'conflict' };
    const fields = Object.fromEntries(
      Object.keys(familyLimits).map((key) => [key, values[key] ?? '']),
    );
    const parsed = recordSchema.safeParse({
      version: 1,
      id: previous?.id ?? crypto.randomUUID(),
      epoch,
      scope,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      expiresAt: previous?.expiresAt ?? now + FAMILY_TTL,
      revision: (previous?.revision ?? 0) + 1,
      fields,
    });
    if (!parsed.success) return { kind: 'unavailable' };
    const raw = JSON.stringify(parsed.data);
    if (raw.length > 5000) return { kind: 'unavailable' };
    sessionStorage.setItem(FAMILY_KEY, raw);
    if (familyEpoch() !== epoch) {
      if (sessionStorage.getItem(FAMILY_KEY) === raw) sessionStorage.removeItem(FAMILY_KEY);
      return { kind: 'inactive' };
    }
    return { kind: 'saved', record: parsed.data };
  } catch {
    return { kind: 'unavailable' };
  }
}
export function completeFamilyRecovery(scope: FamilyScope, ticket: FamilyRecord | null) {
  if (!ticket) return;
  try {
    const current = readRecord();
    if (
      current &&
      current.id === ticket.id &&
      current.revision === ticket.revision &&
      current.epoch === ticket.epoch &&
      current.scope.tryoutSlug === scope.tryoutSlug &&
      current.scope.context === scope.context &&
      current.scope.formVersionId === scope.formVersionId
    )
      sessionStorage.removeItem(FAMILY_KEY);
  } catch {
    /* Normal success continues. */
  }
}
