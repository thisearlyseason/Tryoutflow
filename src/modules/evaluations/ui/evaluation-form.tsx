'use client';

import { useEffect, useRef, useState } from 'react';

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
  | { outcome: 'saved'; evaluationId: string; version: number }
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

const memoryDrafts = new Map<string, EditableDraft>();

function editableDraft(input: EvaluationDraftInput): EditableDraft {
  return {
    scores: input.scores,
    note: input.note ?? '',
    noteTagIds: input.noteTagIds ?? [],
    flags: input.flags ?? [],
  };
}

export function EvaluationForm({
  athlete,
  categories,
  draftCacheKey,
  initialDraft,
  noteTags = [],
  onComplete,
  onSave,
}: {
  athlete: EvaluatorAthlete;
  categories: EvaluatorCategory[];
  draftCacheKey?: string;
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
}) {
  const cached = draftCacheKey ? memoryDrafts.get(draftCacheKey) : undefined;
  const [draft, setDraft] = useState<EditableDraft>(() => cached ?? editableDraft(initialDraft));
  const [saveState, setSaveState] = useState<EvaluationSaveStatus>(
    cached ? 'editing' : initialDraft.evaluationId ? 'saved' : 'idle',
  );
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [completionState, setCompletionState] = useState(initialDraft.state);
  const [hydrated, setHydrated] = useState(false);
  const versionRef = useRef(initialDraft.version);
  const evaluationIdRef = useRef(initialDraft.evaluationId);
  const revisionRef = useRef(cached ? 1 : 0);
  const latestDraftRef = useRef(draft);
  const savingRef = useRef(false);
  const blockedRef = useRef(false);
  const editable = completionState === 'draft' || completionState === 'reopened';
  const interactive = editable && hydrated;

  useEffect(() => setHydrated(true), []);

  function updateDraft(next: EditableDraft) {
    latestDraftRef.current = next;
    revisionRef.current += 1;
    if (draftCacheKey) memoryDrafts.set(draftCacheKey, next);
    setDraft(next);
    setMissing(new Set());
    if (!blockedRef.current) setSaveState(navigator.onLine ? 'editing' : 'offline');
  }

  async function flushDraft(): Promise<EvaluationSaveResult | null> {
    if (!editable || savingRef.current || blockedRef.current || revisionRef.current === 0)
      return null;
    if (!navigator.onLine) {
      setSaveState('offline');
      return null;
    }
    savingRef.current = true;
    const savedRevision = revisionRef.current;
    const snapshot = latestDraftRef.current;
    let saveLatestRevision = false;
    setSaveState('saving');
    try {
      const result = await onSave({
        scores: snapshot.scores,
        note: snapshot.note.trim() || undefined,
        noteTagIds: snapshot.noteTagIds,
        flags: snapshot.flags,
        expectedVersion: versionRef.current,
      });
      if (result.outcome === 'saved') {
        versionRef.current = result.version;
        evaluationIdRef.current = result.evaluationId;
        if (savedRevision === revisionRef.current) {
          setSaveState('saved');
        } else {
          saveLatestRevision = true;
        }
      } else if (result.outcome === 'conflict') {
        blockedRef.current = true;
        setSaveState('conflict');
      } else {
        setSaveState('error');
      }
      return result;
    } catch {
      setSaveState(navigator.onLine ? 'error' : 'offline');
      return { outcome: 'unexpected' };
    } finally {
      savingRef.current = false;
      if (saveLatestRevision && !blockedRef.current) void flushDraft();
    }
  }

  useEffect(() => {
    if (!editable || revisionRef.current === 0 || blockedRef.current) return;
    const timer = window.setTimeout(() => void flushDraft(), 600);
    return () => window.clearTimeout(timer);
  }, [draft, editable]);

  useEffect(() => {
    function reconnect() {
      if (!blockedRef.current && revisionRef.current > 0) {
        setSaveState('editing');
        void flushDraft();
      }
    }
    function disconnect() {
      if (revisionRef.current > 0) setSaveState('offline');
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

  async function complete() {
    const scored = new Set(draft.scores.map((score) => score.categoryId));
    const missingCategories = categories.filter(
      (category) => category.required && !scored.has(category.id),
    );
    if (missingCategories.length > 0) {
      setMissing(new Set(missingCategories.map((category) => category.id)));
      document.getElementById(`score-group-${missingCategories[0]?.id}`)?.focus();
      return;
    }
    const saveResult = await flushDraft();
    if (saveResult && saveResult.outcome !== 'saved') return;
    const evaluationId = evaluationIdRef.current;
    if (!evaluationId) {
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    try {
      const result = await onComplete({ evaluationId, expectedVersion: versionRef.current });
      if (result.outcome === 'completed') {
        versionRef.current = result.version;
        setCompletionState('completed');
        setSaveState('saved');
        if (draftCacheKey) memoryDrafts.delete(draftCacheKey);
      } else if (result.outcome === 'conflict') {
        blockedRef.current = true;
        setSaveState('conflict');
      } else {
        setSaveState('error');
      }
    } catch {
      setSaveState(navigator.onLine ? 'error' : 'offline');
    }
  }

  return (
    <div className="grid min-w-0 gap-5 pb-36">
      <header className="min-w-0 border-b-4 border-[var(--color-text)] pb-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">
              {athlete.identityMode === 'blind' ? 'Blind evaluation' : 'Athlete evaluation'}
            </p>
            <h2 className="break-words" id="athlete-heading">
              {athlete.displayName}
            </h2>
          </div>
          <p className="shrink-0 font-[var(--font-bib)] text-4xl leading-none tabular-nums">
            {athlete.tryoutNumber === null ? '—' : `#${athlete.tryoutNumber}`}
          </p>
        </div>
        <p className="mt-2 break-words text-sm text-[var(--color-text-muted)]">
          {athlete.divisionName} · {athlete.sessionName ?? 'Session'}
          {athlete.groupName ? ` · ${athlete.groupName}` : ''}
        </p>
      </header>

      <section aria-labelledby="scores-heading" className="grid min-w-0 gap-5">
        <div>
          <h3 id="scores-heading">Scores</h3>
          <p className="text-sm text-[var(--color-text-muted)]">
            Choose one whole-number score for every required category.
          </p>
        </div>
        {categories.map((category) => {
          const score =
            draft.scores.find((entry) => entry.categoryId === category.id)?.value ?? null;
          return (
            <fieldset className="grid min-w-0 gap-2" disabled={!interactive} key={category.id}>
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
            <div className="flex min-w-0 flex-wrap gap-2">
              {noteTags.map((tag) => (
                <label className="relative" key={tag.id}>
                  <input
                    checked={draft.noteTagIds.includes(tag.id)}
                    className="peer min-h-[44px] min-w-[44px] appearance-none rounded-full border border-[var(--color-border)] focus:outline-3 focus:outline-offset-2 focus:outline-[var(--color-focus)]"
                    onChange={() =>
                      updateDraft({ ...draft, noteTagIds: toggle(draft.noteTagIds, tag.id) })
                    }
                    type="checkbox"
                  />
                  <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full px-4 text-sm font-bold peer-checked:bg-[var(--color-selection)] peer-checked:text-[var(--color-selection-foreground)]">
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

      <div className="sticky bottom-0 z-20 -mx-4 grid min-w-0 gap-3 border-t border-[var(--color-border)] bg-[var(--color-canvas)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_24px_rgb(24_33_47/0.12)] sm:grid-cols-[1fr_auto] sm:items-center">
        <EvaluationSaveState state={saveState} />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            className="min-h-[44px] rounded-lg border border-[var(--color-primary)] px-4 font-bold text-[var(--color-primary)] disabled:opacity-50"
            disabled={!interactive || saveState === 'saving' || blockedRef.current}
            onClick={() => void flushDraft()}
            type="button"
          >
            Save now
          </button>
          <button
            className="min-h-[44px] rounded-lg bg-[var(--color-primary)] px-4 font-bold text-[var(--color-primary-foreground)] disabled:opacity-50"
            disabled={!interactive || saveState === 'saving' || blockedRef.current}
            onClick={() => void complete()}
            type="button"
          >
            {completionState === 'completed' || completionState === 'locked'
              ? 'Evaluation completed'
              : 'Complete evaluation'}
          </button>
        </div>
      </div>
    </div>
  );
}
