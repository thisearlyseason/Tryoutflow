'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { createEvaluationOfflineRepository } from '../offline/repository';
import { createEvaluationMutationSender, EvaluationSynchronizer } from '../offline/synchronizer';
import {
  scopeKey,
  type EvaluationStorageScope,
  type StoredEvaluationMutation,
} from '../offline/database';
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
  const blockingLineageRef = useRef<StoredEvaluationMutation | null>(null);
  const relevantMutationIdsRef = useRef(new Set<string>());
  const [initialDraft, setInitialDraft] = useState<EvaluationDraftInput>(props.initialDraft);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [serverConfirmation, setServerConfirmation] = useState<{
    evaluationId: string;
    version: number;
  } | null>(null);
  const [backgroundSaveResult, setBackgroundSaveResult] = useState<
    | {
        token: number;
        outcome: 'forbidden' | 'invalid_input' | 'invalid_context' | 'conflict' | 'unexpected';
        serverFresh?: boolean;
      }
    | {
        token: number;
        outcome: 'resolved_elsewhere';
        draft: {
          scores: { categoryId: string; value: number }[];
          note: string;
          noteTagIds: string[];
          flags: string[];
        };
        evaluationId: string;
        version: number;
      }
    | null
  >(null);
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
    let reconciliation = Promise.resolve();
    function rememberLineage(
      active: StoredEvaluationMutation | undefined,
      blocking: StoredEvaluationMutation | undefined,
    ) {
      activeLineageRef.current = active
        ? {
            clientMutationId: active.clientMutationId,
            evaluationId: active.evaluationId,
            expectedVersion: active.expectedVersion,
            payloadDigest: active.payloadDigest,
          }
        : null;
      blockingLineageRef.current = blocking ?? null;
      relevantMutationIdsRef.current = new Set(
        [active?.clientMutationId, blocking?.clientMutationId].filter(
          (value): value is string => value !== undefined,
        ),
      );
    }
    async function refreshConfirmation() {
      if (!navigator.onLine) return;
      await activeSynchronizer.flush();
      const reconciled = await activeRepository.reconcileDraftLineage(storageScope);
      rememberLineage(reconciled.mutation, reconciled.blockingMutation);
      if (
        reconciled.state === 'needs_attention' ||
        (reconciled.blockingMutation &&
          reconciled.blockingMutation.clientMutationId !== reconciled.mutation?.clientMutationId)
      ) {
        if (!cancelled) setServerConfirmation(null);
        return;
      }
      if (reconciled.confirmation) {
        if (!cancelled) {
          evaluationIdRef.current = reconciled.confirmation.evaluationId;
          setServerConfirmation({
            evaluationId: reconciled.confirmation.evaluationId,
            version: reconciled.confirmation.serverVersion,
          });
        }
        return;
      }
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
      if (cancelled || event.scopeKey !== scopeKey(storageScope)) return;
      // A sibling tab can discover an earlier blocker unknown when this form mounted. Every
      // same-scope signal therefore re-queries the durable natural lineage instead of filtering
      // by the mutation IDs this instance happened to know already.
      reconciliation = reconciliation.then(async () => {
        try {
          const lineage = await activeRepository.reconcileDraftLineage(storageScope);
          if (cancelled) return;
          const priorBlocker = blockingLineageRef.current;
          rememberLineage(lineage.mutation, lineage.blockingMutation);
          const blocker = lineage.blockingMutation;
          if (blocker?.status === 'needs_attention') {
            setServerConfirmation(null);
            const category = blocker.errorCategory;
            setBackgroundSaveResult({
              token: Date.now(),
              outcome:
                category === 'forbidden'
                  ? 'forbidden'
                  : category === 'invalid_input'
                    ? 'invalid_input'
                    : category === 'invalid_rubric'
                      ? 'invalid_context'
                      : category === 'conflict'
                        ? 'conflict'
                        : 'unexpected',
              ...(category === 'conflict' &&
              blocker.conflictServerEvaluationId === props.initialDraft.evaluationId &&
              blocker.conflictServerVersion === props.initialDraft.version
                ? { serverFresh: true }
                : {}),
            });
            return;
          }
          if (
            event.origin === 'remote' &&
            ((priorBlocker?.status === 'needs_attention' &&
              priorBlocker.errorCategory === 'conflict') ||
              lineage.resolution) &&
            lineage.confirmation &&
            lineage.draft
          ) {
            evaluationIdRef.current = lineage.confirmation.evaluationId;
            setServerConfirmation({
              evaluationId: lineage.confirmation.evaluationId,
              version: lineage.confirmation.serverVersion,
            });
            setBackgroundSaveResult({
              token: Date.now(),
              outcome: 'resolved_elsewhere',
              draft: {
                scores: lineage.draft.draft.scores,
                note: lineage.draft.draft.note ?? '',
                noteTagIds: lineage.draft.draft.noteTagIds,
                flags: lineage.draft.draft.flags,
              },
              evaluationId: lineage.confirmation.evaluationId,
              version: lineage.confirmation.serverVersion,
            });
            return;
          }
          // The event is only a bounded re-query pulse. Durable lineage above is the sole UI
          // authority, so stale or reordered payload state can never recreate recovery.
          if (lineage.confirmation) await refreshConfirmation();
        } catch {
          if (!cancelled) {
            setServerConfirmation(null);
            setBackgroundSaveResult({ token: Date.now(), outcome: 'unexpected' });
          }
        }
      });
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
            rememberLineage(undefined, undefined);
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
          const blockingMutation = lineage.blockingMutation;
          rememberLineage(activeMutation, blockingMutation);
          const optimisticVersion = activeMutation
            ? activeMutation.expectedVersion + 1
            : local.expectedVersion;
          const evaluationId = activeMutation?.evaluationId ?? local.evaluationId;
          if (evaluationId) evaluationIdRef.current = evaluationId;
          if (!cancelled) {
            setServerConfirmation(
              lineage.confirmation &&
                lineage.state !== 'needs_attention' &&
                (!blockingMutation ||
                  blockingMutation.clientMutationId === activeMutation?.clientMutationId)
                ? {
                    evaluationId: lineage.confirmation.evaluationId,
                    version: lineage.confirmation.serverVersion,
                  }
                : null,
            );
            if (lineage.state === 'needs_attention') {
              const category = blockingMutation?.errorCategory;
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
                blockingMutation?.conflictServerEvaluationId === props.initialDraft.evaluationId &&
                blockingMutation.conflictServerVersion === props.initialDraft.version
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
    relevantMutationIdsRef.current.add(queued.clientMutationId);
    blockingLineageRef.current ??= queued;
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
    const blocking = blockingLineageRef.current;
    const head = (await repository.listMutations(storageScope)).find(
      (row) =>
        row.clientMutationId === blocking?.clientMutationId &&
        row.evaluationId === blocking.evaluationId &&
        row.payloadDigest === blocking.payloadDigest &&
        row.queueSequence === blocking.queueSequence &&
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
    const localDraft = {
      scores: input.local.scores,
      ...(input.local.note ? { note: input.local.note } : {}),
      noteTagIds: input.local.noteTagIds,
      flags: input.local.flags as (
        'needs_another_look' | 'injury_concern' | 'eligibility_review'
      )[],
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
      local: localDraft,
      server: {
        scope: storageScope,
        evaluationId: props.initialDraft.evaluationId,
        version: props.initialDraft.version,
        draft: serverDraft,
      },
    });
    synchronizer.signalDurableChange({
      scopeKey: scopeKey(storageScope),
      evaluationId: resolved.evaluationId,
      clientMutationId: head.clientMutationId,
      state: input.action === 'keep_local' ? 'saved_device' : 'synced',
    });
    evaluationIdRef.current = resolved.evaluationId;
    if (input.action === 'keep_local') {
      const successor = resolved.clientMutationId
        ? (await repository.listMutations(storageScope)).find(
            (row) =>
              row.clientMutationId === resolved.clientMutationId &&
              row.evaluationId === resolved.evaluationId &&
              row.expectedVersion === resolved.expectedVersion &&
              row.queueSequence === resolved.queueSequence &&
              row.payloadDigest === resolved.payloadDigest,
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
      blockingLineageRef.current = successor ?? null;
      relevantMutationIdsRef.current = new Set(successor ? [successor.clientMutationId] : []);
      await synchronizer.flush();
      const receipt = resolved.clientMutationId
        ? await repository.getReceipt(storageScope, resolved.clientMutationId)
        : null;
      if (
        receipt &&
        receipt.clientMutationId === resolved.clientMutationId &&
        receipt.evaluationId === resolved.evaluationId &&
        receipt.expectedVersion === resolved.expectedVersion &&
        receipt.payloadDigest === resolved.payloadDigest
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
    blockingLineageRef.current = null;
    relevantMutationIdsRef.current.clear();
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
