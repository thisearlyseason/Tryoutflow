import { z } from 'zod';
import { validStructuredRecovery } from './setup-recovery-structure';

export const RECOVERY_PREFIX = 'tryoutflow.setup-recovery.v1.';
export const RECOVERY_OWNER = `${RECOVERY_PREFIX}owner`;
export const RECOVERY_RESET = 'tryoutflow-setup-recovery-reset';
export type RecoveryOwner = { userId: string; epoch: string };
let lastVerifiedOwner: RecoveryOwner | undefined;
export function lastRecoveryOwner() {
  return lastVerifiedOwner;
}
export const RECOVERY_TTL = 24 * 60 * 60 * 1000;
export type RecoveryScope = {
  userId: string;
  organizationId: string;
  form: string;
  baseline: string;
};
const basics = ['name', 'sport', 'timezone', 'registrationStartsAt', 'registrationEndsAt'] as const;
const limits: Record<string, number> = {
  name: 160,
  sport: 80,
  timezone: 100,
  registrationStartsAt: 32,
  registrationEndsAt: 32,
  seasonId: 128,
  newSeasonName: 120,
  divisionId: 128,
  description: 2000,
  minAge: 3,
  maxAge: 3,
  sessionId: 128,
  startsAt: 32,
  endsAt: 32,
  location: 240,
  capacity: 10,
  groupId: 128,
  groupName: 160,
  positionId: 128,
  positionName: 160,
  categories: 120000,
  questions: 120000,
};
const schema = z
  .object({
    version: z.literal(1),
    id: z.string(),
    ownerEpoch: z.string(),
    scope: z
      .object({
        userId: z.string().max(128),
        organizationId: z.string().max(128),
        form: z.string().max(200),
        baseline: z.string().max(128),
      })
      .strict(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    expiresAt: z.number().int(),
    revision: z.number().int().positive(),
    fields: z.record(z.string(), z.string().max(120000)),
  })
  .strict();
export type RecoveryRecord = z.infer<typeof schema>;
export type RecoveryRead =
  | { kind: 'candidate' | 'stale'; record: RecoveryRecord }
  | { kind: 'none' | 'expired' | 'unavailable' };
export function recoveryKey(scope: RecoveryScope) {
  return (
    RECOVERY_PREFIX +
    [scope.userId, scope.organizationId, scope.form].map(encodeURIComponent).join(':')
  );
}
function names(scope: RecoveryScope) {
  if (scope.form === 'new') return [...basics, 'seasonId', 'newSeasonName'];
  if (/^basics:[^:]+$/.test(scope.form)) return [...basics];
  if (/^divisions:[^:]+$/.test(scope.form))
    return ['divisionId', 'name', 'description', 'minAge', 'maxAge'];
  if (/^sessions:[^:]+$/.test(scope.form))
    return [
      'sessionId',
      'divisionId',
      'name',
      'startsAt',
      'endsAt',
      'location',
      'capacity',
      'groupId',
      'groupName',
      'positionId',
      'positionName',
    ];
  if (/^rubrics:[^:]+$/.test(scope.form)) return ['sessionId', 'name', 'categories'];
  if (/^registration:[^:]+$/.test(scope.form)) return ['name', 'questions'];
  return [];
}
function recordLimit(scope: RecoveryScope) {
  return /^(rubrics|registration):/.test(scope.form) ? 160000 : 10000;
}
export function recoveryStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
export function notifyRecoveryReset() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECOVERY_RESET));
}
export function readRecoveryOwner(storage: Storage | null): RecoveryOwner | null {
  const raw = storage?.getItem(RECOVERY_OWNER);
  if (!raw || raw.length > 512) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.userId === 'string' && typeof value?.epoch === 'string' ? value : null;
  } catch {
    return null;
  }
}
/** Every browser recovery read/mutation runs in this same-origin cross-tab critical section. */
export async function withRecoveryLock<T>(work: () => T | Promise<T>): Promise<T | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) return null;
    return await navigator.locks.request('tryoutflow.setup-recovery', work);
  } catch {
    return null;
  }
}
function purgeWithinLock(expectedOwner?: RecoveryOwner | string) {
  const storage = recoveryStorage();
  if (!storage) return;
  try {
    const current = readRecoveryOwner(storage);
    if (
      expectedOwner &&
      current &&
      (typeof expectedOwner === 'string'
        ? current.userId !== expectedOwner
        : current.userId !== expectedOwner.userId || current.epoch !== expectedOwner.epoch)
    )
      return;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(RECOVERY_PREFIX)) storage.removeItem(key);
    }
  } catch {
    /* No browser access means no promise of persistence. */
  }
}
export async function clearAllSetupRecovery(expectedOwner?: RecoveryOwner | string) {
  notifyRecoveryReset();
  if (!navigator.locks?.request) {
    purgeWithinLock(expectedOwner);
    return;
  }
  await withRecoveryLock(() => purgeWithinLock(expectedOwner));
}
export async function claimRecoveryOwner(
  userId: string,
  stillCurrent: () => boolean = () => true,
): Promise<RecoveryOwner | null> {
  return withRecoveryLock(() => {
    if (!stillCurrent()) return null;
    const storage = recoveryStorage();
    if (!storage) return null;
    try {
      let owner = readRecoveryOwner(storage);
      if (owner?.userId !== userId) {
        purgeWithinLock();
        notifyRecoveryReset();
        owner = { userId, epoch: crypto.randomUUID() };
        storage.setItem(RECOVERY_OWNER, JSON.stringify(owner));
      }
      lastVerifiedOwner = owner;
      return owner;
    } catch {
      return null;
    }
  });
}
export function clearRecoveryRecord(storage: Storage | null, scope: RecoveryScope) {
  try {
    storage?.removeItem(recoveryKey(scope));
  } catch {
    /* Form saving remains available. */
  }
}
export function readRecovery(
  storage: Storage | null,
  scope: RecoveryScope,
  now = Date.now(),
): RecoveryRead {
  if (!storage) return { kind: 'unavailable' };
  try {
    const owner = readRecoveryOwner(storage);
    if (owner?.userId !== scope.userId) return { kind: 'none' };
    const raw = storage.getItem(recoveryKey(scope));
    if (!raw) return { kind: 'none' };
    const discard = (): RecoveryRead => {
      storage.removeItem(recoveryKey(scope));
      return { kind: 'none' };
    };
    if (raw.length > recordLimit(scope)) return discard();
    let parsed: ReturnType<typeof schema.safeParse>;
    try {
      parsed = schema.safeParse(JSON.parse(raw));
    } catch {
      return discard();
    }
    if (!parsed.success) return discard();
    const r = parsed.data;
    const allowed = names(scope);
    if (
      !validStructuredRecovery(scope.form, r.fields) ||
      allowed.length === 0 ||
      r.ownerEpoch !== owner.epoch ||
      r.scope.userId !== scope.userId ||
      r.scope.organizationId !== scope.organizationId ||
      r.scope.form !== scope.form ||
      r.expiresAt - r.createdAt !== RECOVERY_TTL ||
      r.createdAt > now + 60000 ||
      r.updatedAt < r.createdAt ||
      r.updatedAt >= r.expiresAt ||
      Object.keys(r.fields).length !== allowed.length ||
      allowed.some((k) => typeof r.fields[k] !== 'string' || r.fields[k]!.length > limits[k]!) ||
      Object.keys(r.fields).some((k) => !allowed.includes(k))
    )
      return discard();
    if (now >= r.expiresAt) {
      storage.removeItem(recoveryKey(scope));
      return { kind: 'expired' };
    }
    return { kind: r.scope.baseline === scope.baseline ? 'candidate' : 'stale', record: r };
  } catch {
    return { kind: 'unavailable' };
  }
}
export function writeRecovery(
  storage: Storage | null,
  scope: RecoveryScope,
  values: Record<string, string>,
  revision: number | null,
  now = Date.now(),
  expectedEpoch?: string,
):
  | { kind: 'saved'; record: RecoveryRecord }
  | { kind: 'unavailable' | 'inactive' | 'conflict' | 'expired' } {
  if (!storage) return { kind: 'unavailable' };
  try {
    const owner = readRecoveryOwner(storage);
    const ownerRaw = storage.getItem(RECOVERY_OWNER);
    if (owner?.userId !== scope.userId || (expectedEpoch && owner.epoch !== expectedEpoch))
      return { kind: 'inactive' };
    const read = readRecovery(storage, scope, now);
    if (read.kind === 'unavailable' || read.kind === 'expired') return { kind: read.kind };
    if (read.kind === 'stale') return { kind: 'conflict' };
    const previous = read.kind === 'candidate' ? read.record : undefined;
    if ((previous?.revision ?? null) !== revision) return { kind: 'conflict' };
    const allowed = names(scope);
    if (!allowed.length || allowed.some((k) => String(values[k] ?? '').length > limits[k]!))
      return { kind: 'unavailable' };
    const fields = Object.fromEntries(allowed.map((k) => [k, String(values[k] ?? '')]));
    if (!validStructuredRecovery(scope.form, fields)) return { kind: 'unavailable' };
    const record: RecoveryRecord = {
      version: 1,
      id: previous?.id ?? crypto.randomUUID(),
      ownerEpoch: owner.epoch,
      scope: { ...scope },
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      expiresAt: previous?.expiresAt ?? now + RECOVERY_TTL,
      revision: (previous?.revision ?? 0) + 1,
      fields,
    };
    if (JSON.stringify(record).length > recordLimit(scope)) return { kind: 'unavailable' };
    storage.setItem(recoveryKey(scope), JSON.stringify(record));
    if (storage.getItem(RECOVERY_OWNER) !== ownerRaw) {
      if (storage.getItem(recoveryKey(scope)) === JSON.stringify(record))
        storage.removeItem(recoveryKey(scope));
      return { kind: 'inactive' };
    }
    return { kind: 'saved', record };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function completeRecovery(scope: RecoveryScope, ticket: RecoveryRecord | null) {
  if (!ticket) return;
  await withRecoveryLock(() => {
    const storage = recoveryStorage();
    const read = readRecovery(storage, scope);
    if (
      (read.kind === 'candidate' || read.kind === 'stale') &&
      read.record.id === ticket.id &&
      read.record.revision === ticket.revision &&
      read.record.ownerEpoch === ticket.ownerEpoch
    )
      clearRecoveryRecord(storage, scope);
  });
}
