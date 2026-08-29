'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { createEvaluationOfflineRepository } from '../offline/repository';
import { createEvaluationMutationSender, EvaluationSynchronizer } from '../offline/synchronizer';
import type { EvaluationStorageScope } from '../offline/database';
import {
  EvaluationForm,
  type EvaluationDraftInput,
  type EvaluationSaveResult,
  type EvaluatorCategory,
} from './evaluation-form';

type FormProps = Parameters<typeof EvaluationForm>[0];
type SynchronizedProps =
  | (Omit<Extract<FormProps, { draftCacheKey: string }>, 'onSave' | 'durableDeviceSave'> & {
      storageScope: EvaluationStorageScope;
    })
  | (Omit<Extract<FormProps, { draftCacheKey?: undefined }>, 'onSave' | 'durableDeviceSave'> & {
      storageScope: EvaluationStorageScope;
    });

export function SynchronizedEvaluationForm({ storageScope, ...props }: SynchronizedProps) {
  const evaluationIdRef = useRef(props.initialDraft.evaluationId ?? crypto.randomUUID());
  const [initialDraft, setInitialDraft] = useState<EvaluationDraftInput>(props.initialDraft);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [serverConfirmation, setServerConfirmation] = useState<{
    evaluationId: string;
    version: number;
  } | null>(
    props.initialDraft.evaluationId
      ? { evaluationId: props.initialDraft.evaluationId, version: props.initialDraft.version }
      : null,
  );
  const [backgroundSaveResult, setBackgroundSaveResult] = useState<{
    token: number;
    outcome: 'forbidden' | 'invalid_input' | 'invalid_context' | 'conflict' | 'unexpected';
  } | null>(null);
  const repository = useMemo(
    () =>
      typeof globalThis.indexedDB === 'undefined' || typeof globalThis.IDBKeyRange === 'undefined'
        ? null
        : createEvaluationOfflineRepository({ authenticatedUserId: storageScope.userId }),
    [storageScope.userId],
  );
  const sender = useMemo(() => createEvaluationMutationSender(), []);
  const synchronizer = useMemo(
    () =>
      repository
        ? new EvaluationSynchronizer({
            repository,
            scope: storageScope,
            send: sender,
            online: () => navigator.onLine,
            eventTarget: typeof window === 'undefined' ? undefined : window,
          })
        : null,
    [repository, sender, storageScope],
  );

  useEffect(() => {
    if (!repository || !synchronizer) return;
    const activeRepository = repository;
    const activeSynchronizer = synchronizer;
    let cancelled = false;
    async function refreshConfirmation() {
      if (!navigator.onLine) return;
      await activeSynchronizer.flush();
      const terminal = (await activeRepository.listMutations(storageScope))
        .filter((mutation) => mutation.status === 'acknowledged')
        .sort((left, right) => right.queueSequence - left.queueSequence)[0];
      if (!terminal) return;
      const receipt = await activeRepository.getReceipt(storageScope, terminal.clientMutationId);
      if (receipt && !cancelled) {
        evaluationIdRef.current = receipt.evaluationId;
        setServerConfirmation({
          evaluationId: receipt.evaluationId,
          version: receipt.serverVersion,
        });
      }
    }
    const unsubscribe = activeSynchronizer.subscribe((event) => {
      if (cancelled || event.evaluationId !== evaluationIdRef.current) return;
      if (event.state === 'synced') void refreshConfirmation();
      else if (event.state === 'needs_attention') {
        const outcome =
          event.category === 'forbidden'
            ? 'forbidden'
            : event.category === 'invalid_input'
              ? 'invalid_input'
              : event.category === 'invalid_rubric'
                ? 'invalid_context'
                : event.category === 'conflict'
                  ? 'conflict'
                  : 'unexpected';
        setBackgroundSaveResult({ token: Date.now(), outcome });
      }
    });
    const online = () => void refreshConfirmation();
    async function initialize() {
      try {
        const [local, mutations] = await Promise.all([
          activeRepository.loadDraft(storageScope),
          activeRepository.listMutations(storageScope),
        ]);
        if (local) {
          const latest = mutations.sort(
            (left, right) => right.queueSequence - left.queueSequence,
          )[0];
          const optimisticVersion = latest ? latest.expectedVersion + 1 : local.expectedVersion;
          const evaluationId = latest?.evaluationId ?? local.evaluationId;
          if (evaluationId) evaluationIdRef.current = evaluationId;
          if (!cancelled) {
            if (latest && latest.status !== 'acknowledged') setServerConfirmation(null);
            setInitialDraft({
              evaluationId,
              version: optimisticVersion,
              state:
                props.initialDraft.state === 'completed' || props.initialDraft.state === 'locked'
                  ? props.initialDraft.state
                  : 'draft',
              scores: local.draft.scores,
              note: local.draft.note,
              noteTagIds: local.draft.noteTagIds,
              flags: local.draft.flags,
            });
          }
        }
      } finally {
        if (cancelled) return;
        setDeviceLoaded(true);
        activeSynchronizer.start();
        void refreshConfirmation();
      }
    }
    window.addEventListener('online', online);
    void initialize();
    return () => {
      cancelled = true;
      window.removeEventListener('online', online);
      unsubscribe();
      activeSynchronizer.stop();
    };
  }, [repository, storageScope, synchronizer]);

  async function saveOnDevice(input: {
    scores: { categoryId: string; value: number }[];
    note?: string;
    noteTagIds: string[];
    flags: string[];
    expectedVersion: number;
  }): Promise<EvaluationSaveResult> {
    if (!repository || !synchronizer) return { outcome: 'unexpected' };
    const draft = {
      scores: input.scores,
      ...(input.note ? { note: input.note } : {}),
      noteTagIds: input.noteTagIds,
      flags: input.flags as ('needs_another_look' | 'injury_concern' | 'eligibility_review')[],
    };
    await repository.saveSessionContext({
      scope: storageScope,
      tryoutNumber: props.athlete.tryoutNumber,
      categories: props.categories.map((category: EvaluatorCategory) => ({
        id: category.id,
        scaleMin: category.scaleMin,
        scaleMax: category.scaleMax,
        required: category.required,
      })),
    });
    await repository.saveDraftLocally({
      scope: storageScope,
      evaluationId: evaluationIdRef.current,
      expectedVersion: input.expectedVersion,
      draft,
    });
    const queued = await repository.enqueueEvaluationMutation({
      scope: storageScope,
      evaluationId: evaluationIdRef.current,
      expectedVersion: input.expectedVersion,
      draft,
    });
    if ('serverVersion' in queued) {
      return {
        outcome: 'saved',
        evaluationId: evaluationIdRef.current,
        version: queued.serverVersion,
      };
    }
    if (navigator.onLine) await synchronizer.flush();
    const receipt = await repository.getReceipt(storageScope, queued.clientMutationId);
    if (receipt) {
      setServerConfirmation({
        evaluationId: evaluationIdRef.current,
        version: receipt.serverVersion,
      });
      return {
        outcome: 'saved',
        evaluationId: evaluationIdRef.current,
        version: receipt.serverVersion,
      };
    }
    const mutation = (await repository.listMutations(storageScope)).find(
      (candidate) => candidate.clientMutationId === queued.clientMutationId,
    );
    if (mutation?.status === 'needs_attention') {
      const outcome =
        mutation.errorCategory === 'forbidden'
          ? 'forbidden'
          : mutation.errorCategory === 'invalid_rubric'
            ? 'invalid_context'
            : mutation.errorCategory === 'conflict'
              ? 'conflict'
              : 'unexpected';
      return { outcome };
    }
    return {
      outcome: 'saved_device',
      evaluationId: evaluationIdRef.current,
      version: input.expectedVersion + 1,
    };
  }

  async function resolveRecovery(input: {
    action: 'keep_local' | 'use_server';
    local: {
      scores: { categoryId: string; value: number }[];
      note: string;
      noteTagIds: string[];
      flags: string[];
    };
  }) {
    if (!repository || !synchronizer || !props.initialDraft.evaluationId)
      return { outcome: 'failed' as const };
    const rows = (await repository.listMutations(storageScope))
      .filter(
        (row) =>
          row.evaluationId === props.initialDraft.evaluationId &&
          row.status === 'needs_attention' &&
          row.errorCategory === 'conflict',
      )
      .sort((left, right) => left.queueSequence - right.queueSequence);
    const head = rows[0];
    if (!head) return { outcome: 'failed' as const };
    const serverDraft = {
      scores: props.initialDraft.scores,
      ...(props.initialDraft.note ? { note: props.initialDraft.note } : {}),
      noteTagIds: props.initialDraft.noteTagIds ?? [],
      flags: props.initialDraft.flags ?? [],
    };
    const resolved = await repository.resolveConflict({
      scope: storageScope,
      evaluationId: props.initialDraft.evaluationId,
      clientMutationId: head.clientMutationId,
      action: input.action,
      server: {
        evaluationId: props.initialDraft.evaluationId,
        version: props.initialDraft.version,
        draft: serverDraft,
      },
    });
    if (input.action === 'keep_local') {
      await synchronizer.flush();
      const receipt = resolved.clientMutationId
        ? await repository.getReceipt(storageScope, resolved.clientMutationId)
        : null;
      const version = receipt?.serverVersion ?? resolved.expectedVersion + 1;
      setServerConfirmation({ evaluationId: resolved.evaluationId, version });
      return { outcome: 'resolved' as const, evaluationId: resolved.evaluationId, version };
    }
    setServerConfirmation({
      evaluationId: resolved.evaluationId,
      version: resolved.expectedVersion,
    });
    return {
      outcome: 'resolved' as const,
      evaluationId: resolved.evaluationId,
      version: resolved.expectedVersion,
    };
  }

  if (!repository || !synchronizer || !deviceLoaded) {
    return (
      <p aria-live="polite" role="status">
        Preparing secure device storage…
      </p>
    );
  }

  if (props.draftCacheKey) {
    return (
      <EvaluationForm
        {...props}
        durableDeviceSave
        initialDraft={initialDraft}
        recoveryServerDraft={props.initialDraft}
        key={deviceLoaded ? 'device-loaded' : 'server-loaded'}
        onSave={saveOnDevice}
        backgroundSaveResult={backgroundSaveResult}
        onResolveRecovery={resolveRecovery}
        serverConfirmation={serverConfirmation}
      />
    );
  }
  return (
    <EvaluationForm
      {...props}
      durableDeviceSave
      initialDraft={initialDraft}
      recoveryServerDraft={props.initialDraft}
      key={deviceLoaded ? 'device-loaded' : 'server-loaded'}
      onSave={saveOnDevice}
      backgroundSaveResult={backgroundSaveResult}
      onResolveRecovery={resolveRecovery}
      serverConfirmation={serverConfirmation}
    />
  );
}
