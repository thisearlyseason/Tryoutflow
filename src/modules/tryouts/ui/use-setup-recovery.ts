'use client';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  clearRecoveryRecord,
  completeRecovery,
  readRecovery,
  writeRecovery,
  readRecoveryOwner,
  withRecoveryLock,
  recoveryKey,
  recoveryStorage,
  RECOVERY_OWNER,
  RECOVERY_RESET,
  type RecoveryRecord,
  type RecoveryScope,
} from './setup-recovery-store';

export function useSetupRecovery(
  providedScope: RecoveryScope | undefined,
  values: Record<string, string>,
  restore: (fields: Record<string, string>) => void,
  canRestore: (fields: Record<string, string>) => boolean = () => true,
) {
  const { userId, organizationId, form, baseline } = providedScope ?? {};
  const scope = useMemo(
    () =>
      userId && organizationId && form && baseline !== undefined
        ? { userId, organizationId, form, baseline }
        : undefined,
    [userId, organizationId, form, baseline],
  );
  const [mode, setMode] = useState<'off' | 'enabled' | 'candidate' | 'unavailable'>('off');
  const [ready, setReady] = useState(!scope);
  const [candidate, setCandidate] = useState<RecoveryRecord | null>(null);
  const [entry, setEntry] = useState<RecoveryRecord | null>(null);
  const enabled = useRef(false);
  const epoch = useRef<string | null>(null);
  const revision = useRef<number | null>(null);
  const lastSaved = useRef('');
  const lastEntry = useRef<RecoveryRecord | null>(null);
  const generation = useRef(0);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const canRestoreRef = useRef(canRestore);
  canRestoreRef.current = canRestore;
  const refresh = useCallback(async () => {
    enabled.current = false;
    revision.current = null;
    lastSaved.current = '';
    lastEntry.current = null;
    const observed = ++generation.current;
    if (!scope) {
      setReady(true);
      return;
    }
    const read = await withRecoveryLock(() => readRecovery(recoveryStorage(), scope));
    if (generation.current !== observed) return;
    setEntry(null);
    if (read && (read.kind === 'candidate' || read.kind === 'stale')) {
      setCandidate(read.record);
      setMode('candidate');
    } else {
      setCandidate(null);
      setMode(!read || read.kind === 'unavailable' ? 'unavailable' : 'off');
    }
    setReady(true);
  }, [scope]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
      enabled.current = false;
    };
  }, [refresh]);
  const discard = useCallback(async () => {
    enabled.current = false;
    revision.current = null;
    lastSaved.current = '';
    lastEntry.current = null;
    generation.current++;
    if (scope) await withRecoveryLock(() => clearRecoveryRecord(recoveryStorage(), scope));
    setCandidate(null);
    setEntry(null);
    setMode('off');
  }, [scope]);
  const complete = useCallback(
    async (ticket: RecoveryRecord | null) => {
      enabled.current = false;
      generation.current++;
      if (scope) await completeRecovery(scope, ticket);
      setCandidate(null);
      setEntry(null);
      setMode('off');
    },
    [scope],
  );
  useEffect(() => {
    if (!scope) return;
    const reset = () => {
      enabled.current = false;
      revision.current = null;
      epoch.current = null;
      lastSaved.current = '';
      lastEntry.current = null;
      generation.current++;
      setCandidate(null);
      setEntry(null);
      setMode('off');
    };
    const storage = (event: StorageEvent) => {
      if (event.key === RECOVERY_OWNER) {
        reset();
        return;
      }
      if (event.key === recoveryKey(scope)) void refresh();
    };
    window.addEventListener(RECOVERY_RESET, reset);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(RECOVERY_RESET, reset);
      window.removeEventListener('storage', storage);
    };
  }, [scope, refresh]);
  const persist = useCallback(
    async (next: Record<string, string>): Promise<RecoveryRecord | null> => {
      if (!scope || !enabled.current) return null;
      const snapshot = JSON.stringify(next);
      const observed = generation.current;
      const expectedEpoch = epoch.current;
      const result = await withRecoveryLock(() => {
        if (!enabled.current || generation.current !== observed || !expectedEpoch) return null;
        if (snapshot === lastSaved.current)
          return lastEntry.current ? { kind: 'saved' as const, record: lastEntry.current } : null;
        const saved = writeRecovery(
          recoveryStorage(),
          scope,
          next,
          revision.current,
          Date.now(),
          expectedEpoch,
        );
        if (saved.kind === 'saved') {
          revision.current = saved.record.revision;
          lastSaved.current = snapshot;
          lastEntry.current = saved.record;
        }
        return saved;
      });
      if (generation.current !== observed || !enabled.current) return null;
      if (result?.kind === 'saved') {
        setEntry(result.record);
        return result.record;
      }
      if (!result || result.kind === 'unavailable') {
        enabled.current = false;
        setMode('unavailable');
      } else await refresh();
      return null;
    },
    [scope, refresh],
  );
  useEffect(() => {
    if (mode === 'enabled') void persist(values);
  }, [values, mode, persist]);
  useEffect(() => {
    if (!entry) return;
    const expire = () => {
      if (Date.now() >= entry.expiresAt) void refresh();
    };
    const timer = setTimeout(expire, Math.max(0, entry.expiresAt - Date.now()));
    window.addEventListener('pageshow', expire);
    document.addEventListener('visibilitychange', expire);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pageshow', expire);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [entry, refresh]);
  const enable = async () => {
    if (!scope) return;
    const owner = await withRecoveryLock(() => readRecoveryOwner(recoveryStorage()));
    if (owner?.userId !== scope.userId) {
      setMode('unavailable');
      return;
    }
    enabled.current = true;
    epoch.current = owner.epoch;
    revision.current = null;
    lastSaved.current = '';
    lastEntry.current = null;
    setMode('enabled');
    await persist(values);
  };
  const resume = async () => {
    if (!scope) return;
    const observed = generation.current;
    const read = await withRecoveryLock(() => readRecovery(recoveryStorage(), scope));
    if (generation.current !== observed) return;
    if (read?.kind !== 'candidate') {
      await refresh();
      return;
    }
    if (!canRestoreRef.current(read.record.fields)) {
      setCandidate(read.record);
      setMode('candidate');
      return;
    }
    enabled.current = true;
    epoch.current = read.record.ownerEpoch;
    revision.current = read.record.revision;
    lastSaved.current = JSON.stringify(read.record.fields);
    lastEntry.current = read.record;
    setEntry(read.record);
    setCandidate(null);
    setMode('enabled');
    restoreRef.current(read.record.fields);
  };
  return {
    mode,
    ready,
    candidate,
    entry,
    blocked: !ready || mode === 'candidate',
    stale: Boolean(candidate && candidate.scope.baseline !== scope?.baseline),
    enable,
    resume,
    discard,
    complete,
    beforeSubmit: () => persist(values),
  };
}
