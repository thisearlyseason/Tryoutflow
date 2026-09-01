'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { EvaluationSaveState, type EvaluationSaveStatus } from './save-state';
import { ScoreControl } from './score-control';

export type EvaluatorAthlete = {
  registrationId: string;
  displayName: string;
  identityMode: 'blind' | 'full';
  tryoutNumber: number | null;
  divisionName: string;
  sessionName: string | null;
  groupName: string | null;
};

export type EvaluatorCategory = {
  id: string;
  name: string;
  description: string | null;
  guidance: string | null;
  scaleMin: 1;
  scaleMax: 5 | 10;
  required: boolean;
};

export type EvaluationDraftInput = {
  evaluationId: string | null;
  version: number;
  state: 'draft' | 'completed' | 'locked' | 'reopened';
  scores: { categoryId: string; value: number }[];
  note?: string;
  noteTagIds?: string[];
  flags?: string[];
};

type EditableDraft = {
  scores: { categoryId: string; value: number }[];
  note: string;
  noteTagIds: string[];
  flags: string[];
};

export type EvaluationSaveResult =
  | { outcome: 'saved'; evaluationId: string; version: number; confirmationToken?: string }
  | { outcome: 'saved_device'; evaluationId: string; version: number; confirmationToken?: string }
  | {
      outcome:
        | 'forbidden'
        | 'invalid_input'
        | 'invalid_context'
        | 'invalid_score'
        | 'invalid_note_tag'
        | 'locked'
        | 'conflict'
        | 'unexpected';
    };

export type EvaluationCompleteResult =
  | { outcome: 'completed'; version: number }
  | {
      outcome: 'forbidden' | 'required_scores_missing' | 'locked' | 'conflict' | 'unexpected';
    };

const flagOptions = [
  { value: 'needs_another_look', label: 'Needs another look' },
  { value: 'injury_concern', label: 'Injury concern' },
  { value: 'eligibility_review', label: 'Eligibility review' },
] as const;

function editableDraft(input: EvaluationDraftInput): EditableDraft {
  return {
    scores: input.scores,
    note: input.note ?? '',
    noteTagIds: input.noteTagIds ?? [],
    flags: input.flags ?? [],
  };
}

type SaveRequest = {
  scores: { categoryId: string; value: number }[];
  note?: string;
  noteTagIds: string[];
  flags: string[];
  expectedVersion: number;
};

type RecoveryKind = 'conflict' | 'unconfirmed';

type CachedDraft = {
  draft: EditableDraft;
  baseVersion: number;
  evaluationId: string | null;
  serverSnapshotToken: string | null;
  revision: number;
  recovery: 'dirty' | RecoveryKind;
  lastRequest?: SaveRequest & { revision: number };
  lastCompletion?: { evaluationId: string; expectedVersion: number };
  localAuthority?: {
    revision: number;
    resolutionIdentity: string;
    resultDigest: string;
    pendingConfirmationToken?: string;
  };
};

const editableDraftSchema = z.strictObject({
  scores: z.array(z.strictObject({ categoryId: z.uuid(), value: z.number().int() })).max(100),
  note: z.string().max(4000),
  noteTagIds: z.array(z.uuid()).max(50),
  flags: z.array(z.string().min(1).max(80)).max(20),
});
const saveRequestSchema = editableDraftSchema
  .omit({ note: true })
  .extend({ note: z.string().max(4000).optional(), expectedVersion: z.number().int().min(0) });
const cachedDraftSchema = z.strictObject({
  draft: editableDraftSchema,
  baseVersion: z.number().int().min(0),
  evaluationId: z.uuid().nullable(),
  serverSnapshotToken: z.string().min(1).max(200).nullable().default(null),
  revision: z.number().int().positive(),
  recovery: z.enum(['dirty', 'conflict', 'unconfirmed']),
  lastRequest: saveRequestSchema.extend({ revision: z.number().int().positive() }).optional(),
  lastCompletion: z
    .strictObject({ evaluationId: z.uuid(), expectedVersion: z.number().int().positive() })
    .optional(),
  localAuthority: z
    .strictObject({
      revision: z.number().int().positive(),
      resolutionIdentity: z.string().min(1).max(200),
      resultDigest: z.string().regex(/^[0-9a-f]{64}$/),
      pendingConfirmationToken: z.string().min(1).max(200).optional(),
    })
    .optional(),
});

function cacheStorageKey(key: string): string {
  return `tryoutflow:evaluation-draft:v1:${key}`;
}

function readCachedDraft(key: string): CachedDraft | null {
  try {
    const value = window.sessionStorage.getItem(cacheStorageKey(key));
    if (!value) return null;
    const parsed = cachedDraftSchema.safeParse(JSON.parse(value) as unknown);
    if (parsed.success) return parsed.data;
    window.sessionStorage.removeItem(cacheStorageKey(key));
  } catch {
    // Storage can be unavailable in privacy modes. The visible page draft still remains intact.
  }
  return null;
}

function writeCachedDraft(key: string, value: CachedDraft): boolean {
  try {
    window.sessionStorage.setItem(cacheStorageKey(key), JSON.stringify(value));
    return true;
  } catch {
    // The form remains usable and truthfully describes storage as browser-session best effort.
    return false;
  }
}

function clearCachedDraft(key?: string): void {
  if (!key) return;
  try {
    window.sessionStorage.removeItem(cacheStorageKey(key));
  } catch {
    // Storage can be unavailable without making a confirmed server save fail.
  }
}

export function EvaluationForm({
  athlete,
  categories,
  draftCacheKey,
  initialDraft,
  noteTags = [],
  onComplete,
  onSave,
  serverSnapshotToken,
  durableDeviceSave = false,
  serverConfirmation,
  backgroundSaveResult,
  onResolveRecovery,
  recoveryServerDraft,
  allowVerifiedIdentityRemap = false,
}: {
  athlete: EvaluatorAthlete;
  categories: EvaluatorCategory[];
  initialDraft: EvaluationDraftInput;
  noteTags?: { id: string; label: string }[];
  onComplete: (input: {
    evaluationId: string;
    expectedVersion: number;
  }) => Promise<EvaluationCompleteResult>;
  onSave: (input: {
    scores: { categoryId: string; value: number }[];
    note?: string;
    noteTagIds: string[];
    flags: string[];
    expectedVersion: number;
  }) => Promise<EvaluationSaveResult>;
  durableDeviceSave?: boolean;
  serverConfirmation?: {
    evaluationId: string;
    version: number;
    confirmationToken?: string;
  } | null;
  backgroundSaveResult?:
    | {
        token: number;
        outcome: Exclude<EvaluationSaveResult['outcome'], 'saved' | 'saved_device'>;
        serverFresh?: boolean;
      }
    | {
        token: number;
        outcome: 'resolved_elsewhere';
        draft: EditableDraft;
        evaluationId: string;
        version: number;
        resolutionIdentity: string;
        resultDigest: string;
      }
    | null;
  onResolveRecovery?: (input: {
    action: 'use_server';
    local: EditableDraft;
  }) => Promise<
    | { outcome: 'resolved'; evaluationId: string; version: number }
    | { outcome: 'failed' }
    | { outcome: 'stale_local_draft'; local: EditableDraft }
  >;
  recoveryServerDraft?: EvaluationDraftInput;
  allowVerifiedIdentityRemap?: boolean;
} & (
  | { draftCacheKey: string; serverSnapshotToken: string }
  | { draftCacheKey?: undefined; serverSnapshotToken?: never }
)) {
  const authoritativeServerDraft = recoveryServerDraft ?? initialDraft;
  const serverDraft = editableDraft(authoritativeServerDraft);
  const serverInitiallyConfirmed =
    serverConfirmation === undefined
      ? Boolean(initialDraft.evaluationId)
      : Boolean(
          serverConfirmation &&
          serverConfirmation.evaluationId === initialDraft.evaluationId &&
          serverConfirmation.version >= initialDraft.version,
        );
  const [draft, setDraft] = useState<EditableDraft>(editableDraft(initialDraft));
  const [saveState, setSaveState] = useState<EvaluationSaveStatus>(
    initialDraft.evaluationId
      ? durableDeviceSave && !serverInitiallyConfirmed
        ? 'saved_device'
        : 'saved'
      : 'idle',
  );
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [serverValidation, setServerValidation] = useState<
    'invalid_input' | 'invalid_score' | 'invalid_note_tag' | 'required_scores_missing' | null
  >(null);
  const [completionState, setCompletionState] = useState(initialDraft.state);
  const [hydrated, setHydrated] = useState(false);
  const [restriction, setRestriction] = useState<'forbidden' | 'invalid_context' | 'locked' | null>(
    initialDraft.state === 'locked' ? 'locked' : null,
  );
  const [recovery, setRecovery] = useState<{
    kind: RecoveryKind;
    local: EditableDraft;
    server: EditableDraft;
    serverFresh: boolean;
    durable: boolean;
    lastRequest?: CachedDraft['lastRequest'];
    lastCompletion?: CachedDraft['lastCompletion'];
  } | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [completing, setCompleting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [online, setOnline] = useState(false);
  const [useServerConfirmation, setUseServerConfirmation] = useState<{
    localDraftSnapshot: string;
  } | null>(null);
  const versionRef = useRef(initialDraft.version);
  const evaluationIdRef = useRef(initialDraft.evaluationId);
  const revisionRef = useRef(0);
  const confirmedRevisionRef = useRef(0);
  const latestDraftRef = useRef(draft);
  const drainGoalRef = useRef(0);
  const drainPromiseRef = useRef<Promise<EvaluationSaveResult | null> | null>(null);
  const blockedRef = useRef(false);
  const restrictionRef = useRef(restriction);
  const completionGateRef = useRef(false);
  const completionPromiseRef = useRef<Promise<void> | null>(null);
  const serverConfirmedRef = useRef(serverInitiallyConfirmed);
  const debounceTimerRef = useRef<number | null>(null);
  const recoveryKindRef = useRef<RecoveryKind | null>(null);
  const recoveryOpenedAtRevisionRef = useRef<number | null>(null);
  const lastRequestRef = useRef<CachedDraft['lastRequest']>(undefined);
  const lastCompletionRef = useRef<CachedDraft['lastCompletion']>(undefined);
  const storageAvailableRef = useRef(Boolean(draftCacheKey));
  const localAuthorityRef = useRef<CachedDraft['localAuthority']>(undefined);
  const editable = completionState === 'draft' || completionState === 'reopened';
  const interactive = editable && hydrated && !restriction && !completing && !resolving;

  useEffect(() => {
    const refreshOnlineState = () => setOnline(navigator.onLine);
    refreshOnlineState();
    window.addEventListener('online', refreshOnlineState);
    window.addEventListener('offline', refreshOnlineState);
    return () => {
      window.removeEventListener('online', refreshOnlineState);
      window.removeEventListener('offline', refreshOnlineState);
    };
  }, []);

  useEffect(() => {
    if (
      !hydrated ||
      !serverConfirmation ||
      serverConfirmation.evaluationId !== evaluationIdRef.current ||
      serverConfirmation.version < versionRef.current
    )
      return;
    evaluationIdRef.current = serverConfirmation.evaluationId;
    versionRef.current = Math.max(versionRef.current, serverConfirmation.version);
    if (localAuthorityRef.current) {
      if (
        localAuthorityRef.current.pendingConfirmationToken === undefined ||
        localAuthorityRef.current.pendingConfirmationToken !==
          serverConfirmation.confirmationToken ||
        confirmedRevisionRef.current !== localAuthorityRef.current.revision
      )
        return;
      localAuthorityRef.current = undefined;
    }
    serverConfirmedRef.current = true;
    if (confirmedRevisionRef.current === revisionRef.current && !blockedRef.current) {
      setSaveState('saved');
      clearCachedDraft(draftCacheKey);
    }
  }, [draftCacheKey, hydrated, serverConfirmation]);

  useEffect(() => {
    if (!backgroundSaveResult || !hydrated) return;
    if (backgroundSaveResult.outcome === 'resolved_elsewhere') {
      const editedAfterRecoveryOpened =
        recoveryOpenedAtRevisionRef.current !== null &&
        revisionRef.current > recoveryOpenedAtRevisionRef.current;
      const existingAuthority = localAuthorityRef.current;
      const preserveLocal = Boolean(existingAuthority) || editedAfterRecoveryOpened;
      evaluationIdRef.current = backgroundSaveResult.evaluationId;
      versionRef.current = Math.max(versionRef.current, backgroundSaveResult.version);
      blockedRef.current = false;
      recoveryKindRef.current = null;
      setRecovery(null);
      if (preserveLocal) {
        const changedWinner =
          existingAuthority !== undefined &&
          (existingAuthority.resolutionIdentity !== backgroundSaveResult.resolutionIdentity ||
            existingAuthority.resultDigest !== backgroundSaveResult.resultDigest);
        localAuthorityRef.current = {
          revision: revisionRef.current,
          resolutionIdentity: backgroundSaveResult.resolutionIdentity,
          resultDigest: backgroundSaveResult.resultDigest,
        };
        serverConfirmedRef.current = false;
        confirmedRevisionRef.current = 0;
        drainGoalRef.current = 0;
        setRecoveryNotice(
          changedWinner
            ? 'The server result changed again. Your newer local edit is still protected for an explicit save or rebase.'
            : 'A newer edit was preserved after another tab resolved the conflict.',
        );
        setSaveState(navigator.onLine ? 'editing' : 'offline');
        persistDraft('dirty');
        return;
      }
      recoveryOpenedAtRevisionRef.current = null;
      lastRequestRef.current = undefined;
      lastCompletionRef.current = undefined;
      localAuthorityRef.current = undefined;
      latestDraftRef.current = backgroundSaveResult.draft;
      revisionRef.current = 0;
      confirmedRevisionRef.current = 0;
      drainGoalRef.current = 0;
      serverConfirmedRef.current = true;
      setDraft(backgroundSaveResult.draft);
      setRecoveryNotice('This evaluation was resolved and saved in another tab.');
      setSaveState('saved');
      clearCachedDraft(draftCacheKey);
      return;
    }
    const request = lastRequestRef.current;
    if (backgroundSaveResult.outcome === 'conflict')
      requireRecovery('conflict', request, backgroundSaveResult.serverFresh);
    else if (
      backgroundSaveResult.outcome === 'forbidden' ||
      backgroundSaveResult.outcome === 'invalid_context' ||
      backgroundSaveResult.outcome === 'locked'
    )
      restrictEditing(backgroundSaveResult.outcome);
    else if (
      backgroundSaveResult.outcome === 'invalid_input' ||
      backgroundSaveResult.outcome === 'invalid_score' ||
      backgroundSaveResult.outcome === 'invalid_note_tag'
    ) {
      setServerValidation(backgroundSaveResult.outcome);
      setSaveState(backgroundSaveResult.outcome);
      persistDraft('dirty');
    } else requireRecovery('unconfirmed', request);
  }, [backgroundSaveResult, hydrated]);

  function persistDraft(recoveryState: CachedDraft['recovery'] = 'dirty'): boolean {
    if (
      !draftCacheKey ||
      (recoveryState === 'dirty' &&
        revisionRef.current === confirmedRevisionRef.current &&
        !localAuthorityRef.current)
    )
      return storageAvailableRef.current;
    const stored = writeCachedDraft(draftCacheKey, {
      draft: latestDraftRef.current,
      baseVersion: versionRef.current,
      evaluationId: evaluationIdRef.current,
      serverSnapshotToken: serverSnapshotToken ?? null,
      revision: Math.max(1, revisionRef.current),
      recovery: recoveryState,
      lastRequest: lastRequestRef.current,
      lastCompletion: lastCompletionRef.current,
      ...(localAuthorityRef.current ? { localAuthority: localAuthorityRef.current } : {}),
    });
    storageAvailableRef.current = stored;
    return stored;
  }

  useEffect(() => {
    setHydrated(true);
    if (!draftCacheKey) return;
    const cached = readCachedDraft(draftCacheKey);
    if (!editable && !cached) {
      clearCachedDraft(draftCacheKey);
      return;
    }
    if (!cached) return;
    latestDraftRef.current = cached.draft;
    revisionRef.current = cached.revision;
    confirmedRevisionRef.current = 0;
    setDraft(cached.draft);
    lastRequestRef.current = cached.lastRequest;
    lastCompletionRef.current = cached.lastCompletion;
    localAuthorityRef.current = cached.localAuthority;
    if (cached.serverSnapshotToken === null) {
      storageAvailableRef.current = writeCachedDraft(draftCacheKey, {
        ...cached,
        serverSnapshotToken,
      });
    }
    const needsReview =
      !editable ||
      cached.recovery === 'conflict' ||
      cached.recovery === 'unconfirmed' ||
      cached.baseVersion !== initialDraft.version ||
      cached.evaluationId !== initialDraft.evaluationId;
    if (needsReview) {
      const kind: RecoveryKind = cached.recovery === 'unconfirmed' ? 'unconfirmed' : 'conflict';
      const serverFresh =
        Boolean(serverSnapshotToken) &&
        Boolean(cached.serverSnapshotToken) &&
        cached.serverSnapshotToken !== serverSnapshotToken &&
        authoritativeServerDraft.version >= cached.baseVersion &&
        (cached.evaluationId === null ||
          cached.evaluationId === authoritativeServerDraft.evaluationId ||
          (allowVerifiedIdentityRemap && Boolean(onResolveRecovery)));
      blockedRef.current = true;
      recoveryKindRef.current = kind;
      recoveryOpenedAtRevisionRef.current = revisionRef.current;
      setRecovery({
        kind,
        local: cached.draft,
        server: serverDraft,
        serverFresh,
        durable: true,
        lastRequest: cached.lastRequest,
        lastCompletion: cached.lastCompletion,
      });
      setSaveState(initialDraft.state === 'locked' ? 'locked' : kind);
      return;
    }
    setSaveState(navigator.onLine ? 'editing' : 'offline');
  }, []);

  function updateDraft(next: EditableDraft) {
    if (completionGateRef.current || restrictionRef.current) return;
    latestDraftRef.current = next;
    revisionRef.current += 1;
    if (localAuthorityRef.current)
      localAuthorityRef.current = {
        ...localAuthorityRef.current,
        revision: revisionRef.current,
      };
    if (drainPromiseRef.current) drainGoalRef.current = revisionRef.current;
    setDraft(next);
    if (recovery) setRecovery({ ...recovery, local: next, durable: persistDraft(recovery.kind) });
    setMissing(new Set());
    setServerValidation(null);
    if (!recovery) persistDraft(recoveryKindRef.current ?? 'dirty');
    if (!blockedRef.current) setSaveState(navigator.onLine ? 'editing' : 'offline');
  }

  function restrictEditing(kind: 'forbidden' | 'invalid_context' | 'locked') {
    restrictionRef.current = kind;
    setRestriction(kind);
    if (kind === 'locked') setCompletionState('locked');
    setSaveState(kind);
    persistDraft('dirty');
  }

  function requireRecovery(
    kind: RecoveryKind,
    request: CachedDraft['lastRequest'],
    serverFresh = false,
  ) {
    blockedRef.current = true;
    recoveryKindRef.current = kind;
    recoveryOpenedAtRevisionRef.current = revisionRef.current;
    lastRequestRef.current = request;
    const durable = persistDraft(kind);
    setRecovery({
      kind,
      local: latestDraftRef.current,
      server: serverDraft,
      serverFresh,
      durable,
      lastRequest: request,
      lastCompletion: lastCompletionRef.current,
    });
    setSaveState(kind);
  }

  function handleSaveFailure(
    result: Exclude<EvaluationSaveResult, { outcome: 'saved' }>,
    request: SaveRequest & { revision: number },
  ) {
    switch (result.outcome) {
      case 'forbidden':
      case 'invalid_context':
      case 'locked':
        restrictEditing(result.outcome);
        return;
      case 'invalid_input':
      case 'invalid_score':
      case 'invalid_note_tag':
        setServerValidation(result.outcome);
        setSaveState(result.outcome);
        persistDraft('dirty');
        return;
      case 'conflict':
        requireRecovery('conflict', request);
        return;
      case 'unexpected':
        requireRecovery('unconfirmed', request);
    }
  }

  async function runDrain(): Promise<EvaluationSaveResult | null> {
    let lastResult: EvaluationSaveResult | null = null;
    while (confirmedRevisionRef.current < drainGoalRef.current) {
      if (!editable || blockedRef.current || restrictionRef.current) return lastResult;
      if (!navigator.onLine && !durableDeviceSave) {
        setSaveState('offline');
        persistDraft('dirty');
        return null;
      }
      const savedRevision = revisionRef.current;
      const snapshot = latestDraftRef.current;
      const request: SaveRequest & { revision: number } = {
        scores: snapshot.scores,
        note: snapshot.note.trim() || undefined,
        noteTagIds: snapshot.noteTagIds,
        flags: snapshot.flags,
        expectedVersion: versionRef.current,
        revision: savedRevision,
      };
      lastRequestRef.current = request;
      persistDraft('dirty');
      setSaveState('saving');
      let result: EvaluationSaveResult;
      try {
        result = await onSave({
          scores: request.scores,
          note: request.note,
          noteTagIds: request.noteTagIds,
          flags: request.flags,
          expectedVersion: request.expectedVersion,
        });
      } catch {
        result = { outcome: 'unexpected' };
      }
      lastResult = result;
      if (result.outcome !== 'saved' && result.outcome !== 'saved_device') {
        handleSaveFailure(result, request);
        return result;
      }
      versionRef.current = result.version;
      evaluationIdRef.current = result.evaluationId;
      serverConfirmedRef.current = result.outcome === 'saved';
      confirmedRevisionRef.current = savedRevision;
      if (result.outcome === 'saved' && localAuthorityRef.current?.revision === savedRevision)
        localAuthorityRef.current = undefined;
      else if (
        result.outcome === 'saved_device' &&
        result.confirmationToken &&
        localAuthorityRef.current?.revision === savedRevision
      )
        localAuthorityRef.current = {
          ...localAuthorityRef.current,
          pendingConfirmationToken: result.confirmationToken,
        };
      setServerValidation(null);
      if (confirmedRevisionRef.current === revisionRef.current) {
        if (result.outcome === 'saved_device' && localAuthorityRef.current) persistDraft('dirty');
        else {
          clearCachedDraft(draftCacheKey);
          lastRequestRef.current = undefined;
        }
        setSaveState(result.outcome === 'saved' ? 'saved' : 'saved_device');
      } else {
        setSaveState('editing');
        persistDraft('dirty');
      }
    }
    return lastResult;
  }

  function flushDraft(targetRevision = revisionRef.current): Promise<EvaluationSaveResult | null> {
    if (!editable || blockedRef.current || restrictionRef.current) return Promise.resolve(null);
    if (!navigator.onLine && !durableDeviceSave) {
      setSaveState('offline');
      persistDraft('dirty');
      return Promise.resolve(null);
    }
    drainGoalRef.current = Math.max(drainGoalRef.current, targetRevision);
    if (drainPromiseRef.current) return drainPromiseRef.current;
    const pending = runDrain().finally(() => {
      drainPromiseRef.current = null;
    });
    drainPromiseRef.current = pending;
    return pending;
  }

  useEffect(() => {
    if (
      !editable ||
      completionGateRef.current ||
      revisionRef.current === confirmedRevisionRef.current ||
      blockedRef.current ||
      restrictionRef.current
    )
      return;
    debounceTimerRef.current = window.setTimeout(() => void flushDraft(revisionRef.current), 600);
    return () => {
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    };
  }, [draft, editable]);

  useEffect(() => {
    function reconnect() {
      if (
        !blockedRef.current &&
        !restrictionRef.current &&
        revisionRef.current > confirmedRevisionRef.current
      ) {
        setSaveState('editing');
        void flushDraft(revisionRef.current);
      }
    }
    function disconnect() {
      if (revisionRef.current > confirmedRevisionRef.current) setSaveState('offline');
    }
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', disconnect);
    return () => {
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', disconnect);
    };
  });

  function setScore(categoryId: string, value: number) {
    const nextScores = [
      ...draft.scores.filter((score) => score.categoryId !== categoryId),
      { categoryId, value },
    ].sort(
      (left, right) =>
        categories.findIndex((category) => category.id === left.categoryId) -
        categories.findIndex((category) => category.id === right.categoryId),
    );
    updateDraft({ ...draft, scores: nextScores });
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
  }

  function validateRequiredScores(): boolean {
    const scored = new Set(draft.scores.map((score) => score.categoryId));
    const missingCategories = categories.filter(
      (category) => category.required && !scored.has(category.id),
    );
    if (missingCategories.length > 0) {
      setMissing(new Set(missingCategories.map((category) => category.id)));
      document.getElementById(`score-group-${missingCategories[0]?.id}`)?.focus();
      return false;
    }
    return true;
  }

  function complete() {
    if (completionPromiseRef.current || completionGateRef.current || !validateRequiredScores()) {
      return completionPromiseRef.current ?? Promise.resolve();
    }
    completionGateRef.current = true;
    setCompleting(true);
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const targetRevision = revisionRef.current;
    const operation = (async () => {
      const saveResult = await flushDraft(targetRevision);
      if (
        blockedRef.current ||
        restrictionRef.current ||
        confirmedRevisionRef.current < targetRevision ||
        (saveResult && saveResult.outcome !== 'saved')
      ) {
        return;
      }
      const evaluationId = evaluationIdRef.current;
      if (!evaluationId) {
        requireRecovery('unconfirmed', lastRequestRef.current);
        return;
      }
      if (!serverConfirmedRef.current) {
        setSaveState('needs_attention');
        return;
      }
      setSaveState('completing');
      lastCompletionRef.current = { evaluationId, expectedVersion: versionRef.current };
      let result: EvaluationCompleteResult;
      try {
        result = await onComplete({ evaluationId, expectedVersion: versionRef.current });
      } catch {
        result = { outcome: 'unexpected' };
      }
      if (result.outcome === 'completed') {
        versionRef.current = result.version;
        setCompletionState('completed');
        setSaveState('saved');
        lastCompletionRef.current = undefined;
        clearCachedDraft(draftCacheKey);
        return;
      }
      if (result.outcome === 'forbidden' || result.outcome === 'locked') {
        restrictEditing(result.outcome);
        return;
      }
      if (result.outcome === 'required_scores_missing') {
        const requiredIds = categories
          .filter((category) => category.required)
          .map((category) => category.id);
        setMissing(new Set(requiredIds));
        setServerValidation('required_scores_missing');
        setSaveState('required_scores_missing');
        persistDraft('dirty');
        document.getElementById(`score-group-${requiredIds[0]}`)?.focus();
        return;
      }
      if (result.outcome === 'conflict') {
        requireRecovery('conflict', lastRequestRef.current);
        return;
      }
      requireRecovery('unconfirmed', lastRequestRef.current);
    })().finally(() => {
      if (completionState !== 'completed') {
        completionGateRef.current = false;
        setCompleting(false);
      }
      completionPromiseRef.current = null;
    });
    completionPromiseRef.current = operation;
    return operation;
  }

  async function useServerDraft() {
    if (!online || !recovery?.serverFresh) {
      setUseServerConfirmation(null);
      setRecoveryNotice(
        'Connect to the internet and reload the fresh server draft before replacing local work.',
      );
      return;
    }
    const currentSnapshot = JSON.stringify(latestDraftRef.current);
    if (useServerConfirmation?.localDraftSnapshot !== currentSnapshot) {
      setUseServerConfirmation(null);
      setRecoveryNotice(
        'The local draft changed after confirmation opened. Review it and confirm again; nothing was replaced.',
      );
      return;
    }
    setResolving(true);
    const resolution = onResolveRecovery
      ? await onResolveRecovery({ action: 'use_server', local: latestDraftRef.current }).catch(
          () => ({ outcome: 'failed' as const }),
        )
      : null;
    setResolving(false);
    if (resolution?.outcome === 'stale_local_draft') {
      latestDraftRef.current = resolution.local;
      revisionRef.current += 1;
      setDraft(resolution.local);
      setRecovery((current) =>
        current ? { ...current, local: resolution.local, durable: true } : current,
      );
      if (recovery) persistDraft(recovery.kind);
      setUseServerConfirmation(null);
      setRecoveryNotice(
        'A newer local draft was saved in another tab. Review it and confirm the server draft again; nothing was replaced.',
      );
      return;
    }
    if (resolution?.outcome === 'failed') {
      setRecoveryNotice('The local draft is still protected. Reload and try resolving again.');
      return;
    }
    latestDraftRef.current = serverDraft;
    setUseServerConfirmation(null);
    revisionRef.current = 0;
    confirmedRevisionRef.current = 0;
    drainGoalRef.current = 0;
    versionRef.current = resolution?.version ?? authoritativeServerDraft.version;
    evaluationIdRef.current = resolution?.evaluationId ?? authoritativeServerDraft.evaluationId;
    blockedRef.current = false;
    recoveryKindRef.current = null;
    localAuthorityRef.current = undefined;
    lastRequestRef.current = undefined;
    lastCompletionRef.current = undefined;
    setDraft(serverDraft);
    setRecovery(null);
    setRecoveryNotice('Server draft restored. The local session copy was cleared.');
    setSaveState(authoritativeServerDraft.evaluationId ? 'saved' : 'idle');
    clearCachedDraft(draftCacheKey);
  }

  function localRecoveryText(): string {
    return JSON.stringify(
      {
        scores: latestDraftRef.current.scores,
        note: latestDraftRef.current.note,
        noteTagIds: latestDraftRef.current.noteTagIds,
        flags: latestDraftRef.current.flags,
        request: recovery?.lastRequest,
        completionRequest: recovery?.lastCompletion,
      },
      null,
      2,
    );
  }

  async function copyLocalDraft() {
    try {
      await navigator.clipboard.writeText(localRecoveryText());
      setRecoveryNotice(
        'Local draft copied. To keep it, accept the fresh server draft, then deliberately paste or re-enter it as a new online save.',
      );
    } catch {
      setRecoveryNotice(
        'Copy failed. Download the local draft before choosing the server version.',
      );
    }
  }

  function downloadLocalDraft() {
    const url = URL.createObjectURL(new Blob([localRecoveryText()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'evaluation-local-draft.json';
    link.click();
    URL.revokeObjectURL(url);
    setRecoveryNotice(
      'Local draft downloaded. To keep it, accept the fresh server draft, then deliberately paste or re-enter it as a new online save.',
    );
  }

  return (
    <div
      className="theme-game-day grid min-w-0 gap-5 rounded-[var(--radius-surface)] bg-[var(--color-canvas)] p-4 pb-36 text-[var(--color-text)] shadow-[var(--shadow-raised)] sm:p-6 sm:pb-36"
      data-testid="evaluation-game-day"
    >
      <header
        className="game-day-athlete-identity min-w-0 rounded-[var(--radius-surface)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-surface)]"
        data-testid="evaluation-athlete-identity"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">
              {athlete.identityMode === 'blind' ? 'Blind evaluation' : 'Athlete evaluation'}
            </p>
            <h2 className="break-words text-[clamp(2rem,5vw,4rem)]" id="athlete-heading">
              {athlete.displayName}
            </h2>
          </div>
          <p className="shrink-0 rounded-[var(--radius-control)] bg-[var(--color-performance)] px-3 py-2 font-[var(--font-bib)] text-4xl leading-none tabular-nums text-[var(--color-performance-foreground)]">
            {athlete.tryoutNumber === null ? '—' : `#${athlete.tryoutNumber}`}
          </p>
        </div>
        <p className="mt-2 break-words text-sm text-[var(--color-text-muted)]">
          {athlete.divisionName} · {athlete.sessionName ?? 'Session'}
          {athlete.groupName ? ` · ${athlete.groupName}` : ''}
        </p>
      </header>

      {recovery ? (
        <section
          aria-labelledby="draft-recovery-heading"
          className="grid min-w-0 gap-4 rounded-xl border-2 border-[var(--color-destructive)] bg-[var(--color-surface)] p-4"
        >
          <div>
            <h3 id="draft-recovery-heading">Review local and server drafts</h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {recovery.kind === 'unconfirmed'
                ? 'The last request was not confirmed and may have reached the server.'
                : 'The server changed after this local draft began.'}{' '}
              {recovery.durable
                ? ' Reloading is safe while this browser-session copy remains. Compare a freshly loaded server draft before choosing either version.'
                : ' Keep this page open. Copy or download the local draft before leaving because reload would discard it.'}
            </p>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <article
              aria-label="Local draft"
              className="min-w-0 rounded-lg border border-[var(--color-border)] p-3"
            >
              <h4 className="font-bold">Local draft</h4>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {recovery.local.note || 'No local note'}
              </p>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {recovery.local.scores.length} scores · {recovery.local.noteTagIds.length} tags ·{' '}
                {recovery.local.flags.length} flags
              </p>
            </article>
            <article
              aria-label={
                recovery.serverFresh
                  ? 'Server draft loaded after reload'
                  : 'Server draft from page load'
              }
              className="min-w-0 rounded-lg border border-[var(--color-border)] p-3"
            >
              <h4 className="font-bold">
                {recovery.serverFresh
                  ? 'Server draft loaded after reload'
                  : 'Server draft from page load'}
              </h4>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {recovery.server.note || 'No server note'}
              </p>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {recovery.server.scores.length} scores · {recovery.server.noteTagIds.length} tags ·{' '}
                {recovery.server.flags.length} flags
              </p>
            </article>
          </div>
          {recovery.lastRequest ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              Retained request context: local revision {recovery.lastRequest.revision}, expected
              server version {recovery.lastRequest.expectedVersion}.
            </p>
          ) : null}
          {recovery.lastCompletion ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              Retained completion context: evaluation {recovery.lastCompletion.evaluationId},
              expected server version {recovery.lastCompletion.expectedVersion}.
            </p>
          ) : null}
          <p className="text-sm font-bold">
            Evaluator notes are sensitive. This recovery copy uses sessionStorage, contains no
            athlete name, and is cleared after a confirmed save, choosing the server draft, or the
            browser session ending. Use copy/download only on a trusted device.
          </p>
          <p className="text-sm">
            Automatic keep-local recovery is deferred for this release. To keep local work, copy or
            download it first, use the fresh server draft, then deliberately paste or re-enter the
            work and save it as a new ordinary online change.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {!recovery.serverFresh && recovery.durable ? (
              <button
                className="min-h-[44px] rounded-lg border border-[var(--color-primary)] px-4 font-bold sm:col-span-2"
                onClick={() => window.location.reload()}
                type="button"
              >
                Reload and compare safely
              </button>
            ) : null}
            <button
              className="min-h-[44px] rounded-lg border border-[var(--color-primary)] px-4 font-bold"
              onClick={() => void copyLocalDraft()}
              type="button"
            >
              Copy local draft
            </button>
            <button
              className="min-h-[44px] rounded-lg border border-[var(--color-primary)] px-4 font-bold"
              onClick={downloadLocalDraft}
              type="button"
            >
              Download local draft
            </button>
            <button
              className="min-h-[44px] rounded-lg border border-[var(--color-destructive)] px-4 font-bold text-[var(--color-destructive)] sm:col-span-2"
              disabled={resolving || !recovery.serverFresh || !online}
              onClick={() => {
                setUseServerConfirmation({
                  localDraftSnapshot: JSON.stringify(latestDraftRef.current),
                });
                setRecoveryNotice('');
              }}
              type="button"
            >
              Use server draft
            </button>
          </div>
          {useServerConfirmation ? (
            <div
              aria-labelledby="use-server-confirmation-heading"
              aria-modal="true"
              className="grid min-w-0 gap-3 rounded-lg border-2 border-[var(--color-destructive)] p-3"
              role="alertdialog"
            >
              <h4 id="use-server-confirmation-heading">Replace this local draft?</h4>
              <p className="break-words text-sm">
                This permanently replaces the local draft with the fresh server version. Copy or
                download local work first. This action requires an online connection, and any edit
                made after this confirmation opened requires a new confirmation.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  className="min-h-[44px] rounded-lg border border-[var(--color-primary)] px-4 font-bold"
                  onClick={() => setUseServerConfirmation(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="min-h-[44px] rounded-lg bg-[var(--color-destructive)] px-4 font-bold text-white"
                  disabled={resolving || !online}
                  onClick={() => void useServerDraft()}
                  type="button"
                >
                  Confirm use server draft
                </button>
              </div>
            </div>
          ) : null}
          {recoveryNotice ? <p role="status">{recoveryNotice}</p> : null}
        </section>
      ) : recoveryNotice ? (
        <p role="status">{recoveryNotice}</p>
      ) : null}

      <section aria-labelledby="scores-heading" className="grid min-w-0 gap-5">
        <div>
          <h3 id="scores-heading">Scores</h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            Choose one whole-number score for every required category.
          </p>
          {serverValidation === 'invalid_input' ||
          serverValidation === 'invalid_score' ||
          serverValidation === 'required_scores_missing' ? (
            <p className="mt-2 text-sm font-bold text-[var(--color-destructive)]" role="alert">
              Review every score and required field before retrying.
            </p>
          ) : null}
        </div>
        {categories.map((category) => {
          const score =
            draft.scores.find((entry) => entry.categoryId === category.id)?.value ?? null;
          return (
            <fieldset
              className="grid min-w-0 gap-2 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              disabled={!interactive}
              key={category.id}
            >
              <legend className="font-bold">
                {category.name}{' '}
                {category.required ? (
                  <span className="text-[var(--color-destructive)]">Required</span>
                ) : null}
              </legend>
              {category.description ? <p className="text-sm">{category.description}</p> : null}
              {category.guidance ? (
                <p className="text-sm text-[var(--color-text-muted)]">{category.guidance}</p>
              ) : null}
              <ScoreControl
                categoryId={category.id}
                disabled={!interactive}
                error={missing.has(category.id) ? `Choose a ${category.name} score.` : undefined}
                label={category.name}
                max={category.scaleMax}
                min={category.scaleMin}
                onChange={({ categoryId, score: value }) => setScore(categoryId, value)}
                value={score}
              />
            </fieldset>
          );
        })}
      </section>

      <section aria-labelledby="notes-heading" className="grid min-w-0 gap-3">
        <div>
          <h3 id="notes-heading">Your private notes</h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            Other evaluators cannot see this note during live evaluation.
          </p>
        </div>
        <label className="grid gap-1 font-bold">
          Private evaluator note
          <textarea
            className="min-h-28 min-w-0 resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-normal focus:outline-3 focus:outline-offset-2 focus:outline-[var(--color-focus)] disabled:opacity-50"
            disabled={!interactive}
            maxLength={4000}
            onChange={(event) => updateDraft({ ...draft, note: event.target.value })}
            value={draft.note}
          />
        </label>
        {noteTags.length > 0 ? (
          <fieldset className="grid min-w-0 gap-2" disabled={!interactive}>
            <legend className="font-bold">Quick tags</legend>
            {serverValidation === 'invalid_note_tag' ? (
              <p className="text-sm font-bold text-[var(--color-destructive)]" role="alert">
                A selected quick tag is no longer available. Change the selection before retrying.
              </p>
            ) : null}
            <div className="flex min-w-0 flex-wrap gap-2">
              {noteTags.map((tag) => (
                <label className="relative inline-flex min-w-0 max-w-full" key={tag.id}>
                  <input
                    checked={draft.noteTagIds.includes(tag.id)}
                    className="peer absolute inset-0 min-h-[44px] w-full min-w-[44px] appearance-none rounded-full focus:outline-3 focus:outline-offset-2 focus:outline-[var(--color-focus)]"
                    onChange={() =>
                      updateDraft({ ...draft, noteTagIds: toggle(draft.noteTagIds, tag.id) })
                    }
                    type="checkbox"
                  />
                  <span className="pointer-events-none inline-flex min-h-[44px] max-w-full items-center rounded-full border border-[var(--color-border)] px-4 text-center text-sm font-bold peer-checked:bg-[var(--color-selection)] peer-checked:text-[var(--color-selection-foreground)]">
                    {tag.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="grid min-w-0 gap-2" disabled={!interactive}>
          <legend className="font-bold">Evaluator flags</legend>
          <div className="grid min-w-0 gap-2 sm:grid-cols-3">
            {flagOptions.map((flag) => (
              <label className="relative" key={flag.value}>
                <input
                  checked={draft.flags.includes(flag.value)}
                  className="peer min-h-[44px] w-full appearance-none rounded-lg border border-[var(--color-border)] focus:outline-3 focus:outline-offset-2 focus:outline-[var(--color-focus)]"
                  onChange={() => updateDraft({ ...draft, flags: toggle(draft.flags, flag.value) })}
                  type="checkbox"
                />
                <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg px-3 text-center text-sm font-bold peer-checked:bg-[var(--color-selection)] peer-checked:text-[var(--color-selection-foreground)]">
                  {flag.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <div className="sticky bottom-0 z-20 -mx-4 grid min-w-0 gap-3 border-t border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_24px_rgb(0_0_0/0.32)] sm:-mx-6 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
        <EvaluationSaveState
          detail={
            !storageAvailableRef.current &&
            (saveState === 'conflict' || saveState === 'unconfirmed' || saveState === 'offline')
              ? 'This draft exists on this page only. Copy or download it before leaving.'
              : undefined
          }
          state={saveState}
        />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            className="min-h-[44px] rounded-lg border border-[var(--color-primary)] px-4 font-bold text-[var(--color-primary)] disabled:opacity-50"
            disabled={
              !interactive ||
              saveState === 'saving' ||
              saveState === 'completing' ||
              blockedRef.current ||
              revisionRef.current === confirmedRevisionRef.current
            }
            onClick={() => void flushDraft(revisionRef.current)}
            type="button"
          >
            Save now
          </button>
          <button
            className="min-h-[44px] rounded-lg bg-[var(--color-primary)] px-4 font-bold text-[var(--color-primary-foreground)] disabled:opacity-50"
            disabled={
              !interactive ||
              blockedRef.current ||
              (durableDeviceSave &&
                (!serverConfirmedRef.current || confirmedRevisionRef.current < revisionRef.current))
            }
            onClick={() => void complete()}
            type="button"
          >
            {completionState === 'completed' || completionState === 'locked'
              ? 'Evaluation completed'
              : completing
                ? 'Completing evaluation'
                : 'Complete evaluation'}
          </button>
        </div>
      </div>
    </div>
  );
}
