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

function sameDraft(left: EvaluationDraftInput, right: EvaluationDraftInput): boolean {
  return (
    JSON.stringify({
      scores: left.scores,
      note: left.note ?? '',
      noteTagIds: left.noteTagIds ?? [],
      flags: left.flags ?? [],
    }) ===
    JSON.stringify({
      scores: right.scores,
      note: right.note ?? '',
      noteTagIds: right.noteTagIds ?? [],
      flags: right.flags ?? [],
    })
  );
}

export function shouldPreferAuthoritativeServerSnapshot(input: {
  lineageState: 'saved_device' | 'synced' | 'needs_attention';
  local: EvaluationDraftInput;
  server: EvaluationDraftInput;
}): boolean {
  return (
    input.lineageState === 'synced' &&
    input.server.evaluationId === input.local.evaluationId &&
    (input.server.version > input.local.version ||
      (input.server.version === input.local.version && !sameDraft(input.server, input.local)))
  );
}

export function SynchronizedEvaluationForm({ storageScope, ...props }: SynchronizedProps) {
  const evaluationIdRef = useRef(props.initialDraft.evaluationId ?? crypto.randomUUID());
  const activeLineageRef = useRef<{
    clientMutationId: string;
    evaluationId: string;
    expectedVersion: number;
    payloadDigest: string;
  } | null>(null);
  const [initialDraft, setInitialDraft] = useState<EvaluationDraftInput>(props.initialDraft);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [serverConfirmation, setServerConfirmation] = useState<{
    evaluationId: string;
    version: number;
  } | null>(null);
  const [backgroundSaveResult, setBackgroundSaveResult] = useState<{
    token: number;
    outcome: 'forbidden' | 'invalid_input' | 'invalid_context' | 'conflict' | 'unexpected';
    serverFresh?: boolean;
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
      const lineage = activeLineageRef.current;
      if (!lineage) return;
      const receipt = await activeRepository.getReceipt(storageScope, lineage.clientMutationId);
      if (
        receipt &&
        receipt.clientMutationId === lineage.clientMutationId &&
        receipt.evaluationId === lineage.evaluationId &&
        receipt.expectedVersion === lineage.expectedVersion &&
        receipt.payloadDigest === lineage.payloadDigest &&
        !cancelled
      ) {
        evaluationIdRef.current = receipt.evaluationId;
        setServerConfirmation({
          evaluationId: receipt.evaluationId,
          version: receipt.serverVersion,
        });
      }
    }
    const unsubscribe = activeSynchronizer.subscribe((event) => {
      if (cancelled || event.clientMutationId !== activeLineageRef.current?.clientMutationId)
        return;
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
        const lineage = await activeRepository.reconcileDraftLineage(storageScope);
        const local = lineage.draft;
        if (local) {
          const localAsInput: EvaluationDraftInput = {
            evaluationId: local.evaluationId,
            version: local.expectedVersion,
            state: 'draft',
            scores: local.draft.scores,
            note: local.draft.note,
            noteTagIds: local.draft.noteTagIds,
            flags: local.draft.flags,
          };
          const newerServerSnapshot = shouldPreferAuthoritativeServerSnapshot({
            lineageState: lineage.state,
            local: localAsInput,
            server: props.initialDraft,
          });
          if (newerServerSnapshot) {
            activeLineageRef.current = null;
            evaluationIdRef.current = props.initialDraft.evaluationId!;
            if (!cancelled) {
              setInitialDraft(props.initialDraft);
              setServerConfirmation({
                evaluationId: props.initialDraft.evaluationId!,
                version: props.initialDraft.version,
              });
            }
            return;
          }
          const activeMutation = lineage.mutation;
          activeLineageRef.current = activeMutation
            ? {
                clientMutationId: activeMutation.clientMutationId,
                evaluationId: activeMutation.evaluationId,
                expectedVersion: activeMutation.expectedVersion,
                payloadDigest: activeMutation.payloadDigest,
              }
            : null;
          const optimisticVersion = activeMutation
            ? activeMutation.expectedVersion + 1
            : local.expectedVersion;
          const evaluationId = activeMutation?.evaluationId ?? local.evaluationId;
          if (evaluationId) evaluationIdRef.current = evaluationId;
          if (!cancelled) {
            setServerConfirmation(
              lineage.confirmation
                ? {
                    evaluationId: lineage.confirmation.evaluationId,
                    version: lineage.confirmation.serverVersion,
                  }
                : null,
            );
            if (lineage.state === 'needs_attention') {
              const category = activeMutation?.errorCategory;
              setBackgroundSaveResult({
                token: Date.now(),
                outcome:
                  category === 'conflict'
                    ? 'conflict'
                    : category === 'forbidden'
                      ? 'forbidden'
                      : category === 'invalid_input'
                        ? 'invalid_input'
                        : category === 'invalid_rubric'
                          ? 'invalid_context'
                          : 'unexpected',
                ...(category === 'conflict' &&
                activeMutation?.conflictServerEvaluationId === props.initialDraft.evaluationId &&
                activeMutation.conflictServerVersion === props.initialDraft.version
                  ? { serverFresh: true }
                  : {}),
              });
            }
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
        } else if (!cancelled && props.initialDraft.evaluationId) {
          setServerConfirmation({
            evaluationId: props.initialDraft.evaluationId,
            version: props.initialDraft.version,
          });
        }
      } catch {
        if (!cancelled) {
          setServerConfirmation(null);
          setBackgroundSaveResult({ token: Date.now(), outcome: 'unexpected' });
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
    const { mutation: queued } = await repository.saveDraftAndEnqueueMutation({
      scope: storageScope,
      evaluationId: evaluationIdRef.current,
      expectedVersion: input.expectedVersion,
      draft,
    });
    if ('serverVersion' in queued) {
      activeLineageRef.current = null;
      setServerConfirmation({
        evaluationId: queued.evaluationId,
        version: queued.serverVersion,
      });
      return {
        outcome: 'saved',
        evaluationId: queued.evaluationId,
        version: queued.serverVersion,
      };
    }
    activeLineageRef.current = {
      clientMutationId: queued.clientMutationId,
      evaluationId: queued.evaluationId,
      expectedVersion: queued.expectedVersion,
      payloadDigest: queued.payloadDigest,
    };
    setServerConfirmation(null);
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
    const activeClientMutationId = activeLineageRef.current?.clientMutationId;
    const head = (await repository.listMutations(storageScope)).find(
      (row) =>
        row.clientMutationId === activeClientMutationId &&
        row.status === 'needs_attention' &&
        row.errorCategory === 'conflict',
    );
    if (
      !head ||
      !head.conflictServerEvaluationId ||
      !head.conflictServerVersion ||
      props.initialDraft.evaluationId !== head.conflictServerEvaluationId ||
      props.initialDraft.version !== head.conflictServerVersion
    )
      return { outcome: 'failed' as const };
    const serverDraft = {
      scores: props.initialDraft.scores,
      ...(props.initialDraft.note ? { note: props.initialDraft.note } : {}),
      noteTagIds: props.initialDraft.noteTagIds ?? [],
      flags: props.initialDraft.flags ?? [],
    };
    const resolved = await repository.resolveConflict({
      scope: storageScope,
      clientMutationId: head.clientMutationId,
      action: input.action,
      original: {
        evaluationId: head.evaluationId,
        payloadDigest: head.payloadDigest,
        queueSequence: head.queueSequence,
      },
      server: {
        scope: storageScope,
        evaluationId: props.initialDraft.evaluationId,
        version: props.initialDraft.version,
        draft: serverDraft,
      },
    });
    evaluationIdRef.current = resolved.evaluationId;
    if (input.action === 'keep_local') {
      const successor = resolved.clientMutationId
        ? (await repository.listMutations(storageScope)).find(
            (row) => row.clientMutationId === resolved.clientMutationId,
          )
        : null;
      activeLineageRef.current = successor
        ? {
            clientMutationId: successor.clientMutationId,
            evaluationId: successor.evaluationId,
            expectedVersion: successor.expectedVersion,
            payloadDigest: successor.payloadDigest,
          }
        : null;
      await synchronizer.flush();
      const receipt = resolved.clientMutationId
        ? await repository.getReceipt(storageScope, resolved.clientMutationId)
        : null;
      if (
        receipt &&
        receipt.clientMutationId === resolved.clientMutationId &&
        receipt.evaluationId === resolved.evaluationId &&
        receipt.expectedVersion === resolved.expectedVersion
      ) {
        setServerConfirmation({
          evaluationId: receipt.evaluationId,
          version: receipt.serverVersion,
        });
        return {
          outcome: 'resolved' as const,
          evaluationId: receipt.evaluationId,
          version: receipt.serverVersion,
        };
      }
      setServerConfirmation(null);
      return {
        outcome: 'pending' as const,
        evaluationId: resolved.evaluationId,
        version: resolved.expectedVersion + 1,
      };
    }
    activeLineageRef.current = null;
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
        allowVerifiedIdentityRemap
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
      allowVerifiedIdentityRemap
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
