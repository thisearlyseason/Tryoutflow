'use client';

export type EvaluationSaveStatus =
  | 'idle'
  | 'editing'
  | 'saving'
  | 'completing'
  | 'saved'
  | 'conflict'
  | 'offline'
  | 'forbidden'
  | 'invalid_input'
  | 'invalid_context'
  | 'invalid_score'
  | 'invalid_note_tag'
  | 'required_scores_missing'
  | 'locked'
  | 'unconfirmed';

const content: Record<EvaluationSaveStatus, { label: string; detail: string }> = {
  idle: {
    label: 'Not saved yet',
    detail: 'Choose a score or add a note to start this draft.',
  },
  editing: {
    label: 'Unsaved changes on this page',
    detail: 'Keep this tab open until the server confirms the draft.',
  },
  saving: { label: 'Saving to server', detail: 'Your draft is being checked and stored.' },
  completing: {
    label: 'Completing evaluation',
    detail: 'Waiting for every draft revision before the completion request.',
  },
  saved: { label: 'Saved on server', detail: 'The server confirmed this draft.' },
  conflict: {
    label: 'Server draft changed',
    detail: 'Your local draft is retained for this browser session. Review both versions below.',
  },
  offline: {
    label: 'Offline',
    detail: 'Changes are retained for this browser session and are not confirmed by the server.',
  },
  forbidden: {
    label: 'Access removed',
    detail: 'The server did not save this draft. Your evaluator access is no longer active.',
  },
  invalid_input: {
    label: 'Draft validation failed',
    detail: 'The server rejected the draft. Review the highlighted fields before retrying.',
  },
  invalid_context: {
    label: 'Evaluation context changed',
    detail: 'The server did not save. The athlete assignment or rubric is no longer valid.',
  },
  invalid_score: {
    label: 'Score not accepted',
    detail: 'The server rejected at least one score. Review the score controls before retrying.',
  },
  invalid_note_tag: {
    label: 'Tag no longer available',
    detail: 'The server rejected a selected quick tag. Change the tag selection before retrying.',
  },
  required_scores_missing: {
    label: 'Required scores missing',
    detail: 'The server did not complete this evaluation. Review every required score.',
  },
  locked: {
    label: 'Evaluation locked',
    detail: 'The server did not save these changes. Editing is now disabled.',
  },
  unconfirmed: {
    label: 'Save not confirmed',
    detail: 'The response was lost or invalid. The server may have accepted the request.',
  },
};

export function EvaluationSaveState({
  detail,
  state,
}: {
  detail?: string;
  state: EvaluationSaveStatus;
}) {
  const message = content[state];
  const accent =
    state === 'saved'
      ? 'border-[var(--color-performance)]'
      : state === 'conflict' ||
          state === 'forbidden' ||
          state === 'invalid_context' ||
          state === 'locked' ||
          state === 'unconfirmed'
        ? 'border-[var(--color-destructive)]'
        : 'border-[var(--color-primary)]';
  return (
    <div
      aria-atomic="true"
      aria-live={
        state === 'conflict' ||
        state === 'forbidden' ||
        state === 'locked' ||
        state === 'unconfirmed'
          ? 'assertive'
          : 'polite'
      }
      className={`min-w-0 border-l-4 ${accent} pl-3`}
      role="status"
    >
      <p className="font-bold">{message.label}</p>
      <p className="text-xs text-[var(--color-text-muted)]">{detail ?? message.detail}</p>
    </div>
  );
}
