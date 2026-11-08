'use client';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  familyEpoch,
  familyLimits,
  readFamilyRecovery,
  writeFamilyRecovery,
  clearFamilyRecovery,
  completeFamilyRecovery,
  FAMILY_RESET,
  FAMILY_EPOCH,
  invalidateFamilyTab,
  type FamilyScope,
  type FamilyRecord,
} from './family-recovery-store';
export function clearRegistrationDetails(form: HTMLFormElement | null) {
  if (!form) return;
  for (const item of Array.from(form.elements)) {
    if (item instanceof HTMLInputElement) {
      if (item.type === 'hidden') continue;
      if (item.type === 'checkbox' || item.type === 'radio') item.checked = false;
      else item.value = '';
    } else if (item instanceof HTMLSelectElement || item instanceof HTMLTextAreaElement)
      item.value = '';
  }
}
function capture(form: HTMLFormElement | null): Record<string, string> {
  return Object.fromEntries(
    Object.keys(familyLimits).map((key) => {
      const item = form?.elements.namedItem(key);
      return [
        key,
        item instanceof HTMLInputElement || item instanceof HTMLSelectElement ? item.value : '',
      ];
    }),
  );
}
export function useFamilyRecovery(
  provided: FamilyScope | undefined,
  formRef: RefObject<HTMLFormElement | null>,
  restart: () => void,
  validChoices: (fields: Record<string, string>) => boolean,
) {
  const { tryoutSlug, formVersionId, context } = provided ?? {};
  const scope = useMemo(
    () =>
      tryoutSlug && formVersionId && context ? { tryoutSlug, formVersionId, context } : undefined,
    [tryoutSlug, formVersionId, context],
  );
  const key = scope ? JSON.stringify(scope) : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<'off' | 'enabled' | 'candidate' | 'unavailable'>('off');
  const [record, setRecord] = useState<FamilyRecord | null>(null);
  const [note, setNote] = useState('');
  const active = useRef(false);
  const current = useRef<FamilyRecord | null>(null);
  const epoch = useRef<string | null>(null);
  const restartRef = useRef(restart);
  restartRef.current = restart;
  const choicesRef = useRef(validChoices);
  choicesRef.current = validChoices;
  function reset() {
    active.current = false;
    current.current = null;
    epoch.current = familyEpoch();
    setRecord(null);
    setMode('off');
    setNote('Personal details and temporary recovery were cleared.');
    clearRegistrationDetails(formRef.current);
    restartRef.current();
  }
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    active.current = false;
    current.current = null;
    epoch.current = familyEpoch();
    setNote('');
    if (!scope) {
      setLoadedKey(null);
      return;
    }
    const read = readFamilyRecovery(scope);
    setRecord(read.kind === 'candidate' || read.kind === 'stale' ? read.record : null);
    setMode(
      read.kind === 'candidate' || read.kind === 'stale'
        ? 'candidate'
        : read.kind === 'unavailable'
          ? 'unavailable'
          : 'off',
    );
    if (read.kind === 'expired') setNote('The temporary copy expired. Enter your details again.');
    setLoadedKey(key);
    return () => {
      active.current = false;
    };
  }, [scope, key]);
  useEffect(() => {
    const reset = () => resetRef.current();
    const storage = (event: StorageEvent) => {
      if (event.key === FAMILY_EPOCH || event.key === null) reset();
    };
    const restore = () => {
      if (epoch.current && familyEpoch() !== epoch.current) invalidateFamilyTab();
    };
    window.addEventListener(FAMILY_RESET, reset);
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', restore);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(FAMILY_RESET, reset);
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', restore);
      window.removeEventListener('storage', storage);
    };
  }, []);
  useEffect(() => {
    if (!scope || !record) return;
    const expire = () => {
      if (Date.now() < record.expiresAt) return;
      const read = readFamilyRecovery(scope);
      if (read.kind === 'expired' || read.kind === 'none') {
        active.current = false;
        current.current = null;
        setRecord(null);
        setMode('off');
        setNote('The temporary copy expired. Details on screen have not been submitted.');
      }
    };
    const timer = setTimeout(expire, Math.max(0, record.expiresAt - Date.now()));
    window.addEventListener('pageshow', expire);
    document.addEventListener('visibilitychange', expire);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pageshow', expire);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [record, scope]);
  function persist(): FamilyRecord | null {
    if (!scope || !active.current || !epoch.current) return null;
    const prior = current.current;
    const result = writeFamilyRecovery(scope, capture(formRef.current), {
      epoch: epoch.current,
      ...(prior ? { id: prior.id, revision: prior.revision } : {}),
    });
    if (result.kind === 'saved') {
      current.current = result.record;
      setRecord(result.record);
      return result.record;
    }
    active.current = false;
    current.current = null;
    if (result.kind === 'inactive') {
      reset();
      return null;
    }
    if (result.kind === 'conflict') {
      const read = readFamilyRecovery(scope);
      if (read.kind === 'candidate' || read.kind === 'stale') {
        setRecord(read.record);
        setMode('candidate');
        return null;
      }
    }
    setRecord(null);
    setMode(result.kind === 'expired' ? 'off' : 'unavailable');
    if (result.kind === 'expired')
      setNote('The temporary copy expired. Details on screen have not been submitted.');
    return null;
  }
  function enable() {
    if (!scope) return;
    epoch.current = familyEpoch();
    if (!epoch.current) {
      setMode('unavailable');
      return;
    }
    active.current = true;
    current.current = null;
    setMode('enabled');
    setNote('');
    persist();
  }
  function resume() {
    if (!scope) return;
    const read = readFamilyRecovery(scope);
    if (read.kind !== 'candidate' || !choicesRef.current(read.record.fields)) {
      if (read.kind === 'candidate' || read.kind === 'stale') {
        setRecord(read.record);
        setMode('candidate');
      } else {
        setRecord(null);
        setMode(read.kind === 'unavailable' ? 'unavailable' : 'off');
      }
      return;
    }
    clearRegistrationDetails(formRef.current);
    for (const [key, value] of Object.entries(read.record.fields)) {
      const item = formRef.current?.elements.namedItem(key);
      if (item instanceof HTMLInputElement || item instanceof HTMLSelectElement) item.value = value;
    }
    epoch.current = read.record.epoch;
    current.current = read.record;
    active.current = true;
    setRecord(read.record);
    setMode('enabled');
    setNote(
      'Temporary details restored. Review each step, enter omitted details and confirm consent again.',
    );
    restartRef.current();
  }
  return {
    mode,
    record,
    note,
    blocked: scope ? loadedKey !== key || mode === 'candidate' : false,
    stale: Boolean(scope && record && record.scope.formVersionId !== scope.formVersionId),
    invalidChoices: Boolean(record && !validChoices(record.fields)),
    enable,
    resume,
    clear: clearFamilyRecovery,
    changed: persist,
    beforeSubmit: () => {
      if (epoch.current && familyEpoch() !== epoch.current) {
        reset();
        return { blocked: true, ticket: null };
      }
      const before = epoch.current;
      const ticket = persist();
      return {
        blocked: Boolean(
          (scope && (loadedKey !== key || mode === 'candidate')) ||
          (before && familyEpoch() !== before),
        ),
        ticket,
      };
    },
    complete: (ticket: FamilyRecord | null) => {
      active.current = false;
      if (scope) completeFamilyRecovery(scope, ticket);
      current.current = null;
      setRecord(null);
      setMode('off');
    },
  };
}
