'use client';

export type EvaluationSaveStatus =
  'idle' | 'editing' | 'saving' | 'saved' | 'conflict' | 'offline' | 'error';

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
  saved: { label: 'Saved on server', detail: 'The server confirmed this draft.' },
  conflict: {
    label: 'Server draft changed',
    detail: 'Your changes remain on this page. Reload and compare before saving again.',
  },
  offline: {
    label: 'Offline',
    detail: 'Changes remain on this page only. Keep this tab open and reconnect to save.',
  },
  error: {
    label: 'Save failed',
    detail: 'Your changes remain on this page. Try again when the service is available.',
  },
};

export function EvaluationSaveState({ state }: { state: EvaluationSaveStatus }) {
  const message = content[state];
  const accent =
    state === 'saved'
      ? 'border-[var(--color-performance)]'
      : state === 'conflict' || state === 'error'
        ? 'border-[var(--color-destructive)]'
        : 'border-[var(--color-primary)]';
  return (
    <div
      aria-atomic="true"
      aria-live={state === 'conflict' || state === 'error' ? 'assertive' : 'polite'}
      className={`min-w-0 border-l-4 ${accent} pl-3`}
      role="status"
    >
      <p className="font-bold">{message.label}</p>
      <p className="text-xs text-[var(--color-text-muted)]">{message.detail}</p>
    </div>
  );
}
