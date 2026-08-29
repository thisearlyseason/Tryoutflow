'use client';

import { useState, useTransition } from 'react';

type ActionOutcome = { outcome: string; shareUrl?: string };

export function AssignmentWorkspace({
  evaluators,
  scopes,
  onInvite,
  onAssign,
  canInvite = true,
}: {
  evaluators: readonly { userId: string; displayName: string }[];
  scopes: readonly { value: string; label: string }[];
  onInvite(email: string): Promise<ActionOutcome>;
  onAssign(input: { evaluatorUserId: string; scope: string }): Promise<ActionOutcome>;
  canInvite?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      {canInvite ? (
        <form
          className="card min-w-0 space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await onInvite(String(data.get('email') ?? ''));
              setMessage(
                result.outcome === 'invited'
                  ? 'Invitation ready to share.'
                  : 'The invitation could not be created.',
              );
            });
          }}
        >
          <div>
            <p className="eyebrow">Invite</p>
            <h3 className="text-lg font-semibold">Add an evaluator</h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Invitations use the organization membership flow before any tryout access is granted.
            </p>
          </div>
          <label className="grid gap-2 text-sm font-medium">
            Evaluator email
            <input
              autoComplete="email"
              className="min-h-11 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
              name="email"
              required
              type="email"
            />
          </label>
          <button
            className="button-primary min-h-11 w-full sm:w-auto"
            disabled={pending}
            type="submit"
          >
            Send evaluator invitation
          </button>
        </form>
      ) : null}

      <form
        className="card min-w-0 space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(async () => {
            const result = await onAssign({
              evaluatorUserId: String(data.get('evaluatorUserId') ?? ''),
              scope: String(data.get('scope') ?? ''),
            });
            setMessage(
              result.outcome === 'assigned'
                ? 'Evaluator assigned.'
                : result.outcome === 'duplicate'
                  ? 'That active assignment already exists.'
                  : 'The evaluator could not be assigned.',
            );
          });
        }}
      >
        <div>
          <p className="eyebrow">Scope</p>
          <h3 className="text-lg font-semibold">Assign evaluation access</h3>
        </div>
        <label className="grid gap-2 text-sm font-medium">
          Evaluator
          <select
            className="min-h-11 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
            name="evaluatorUserId"
            required
          >
            <option value="">Select evaluator</option>
            {evaluators.map((evaluator) => (
              <option key={evaluator.userId} value={evaluator.userId}>
                {evaluator.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Evaluation scope
          <select
            className="min-h-11 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
            name="scope"
            required
          >
            <option value="">Select scope</option>
            {scopes.map((scope) => (
              <option key={scope.value} value={scope.value}>
                {scope.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button-primary min-h-11 w-full sm:w-auto"
          disabled={pending}
          type="submit"
        >
          Assign evaluator
        </button>
      </form>
      <p
        aria-live="polite"
        className="min-h-6 text-sm text-[var(--color-text-muted)] xl:col-span-2"
      >
        {message}
      </p>
    </div>
  );
}
