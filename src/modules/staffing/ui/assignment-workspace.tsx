'use client';

import { useState, useTransition } from 'react';

type ActionOutcome = { outcome: string; shareUrl?: string };
type ManageableAssignment = {
  assignmentId: string;
  evaluatorUserId: string;
  evaluatorName: string;
  scopeLabel: string;
  scopeKind: 'tryout' | 'division' | 'session' | 'group';
  expiresAt: string | null;
};

export function AssignmentWorkspace({
  evaluators,
  scopes,
  onInvite,
  onAssign,
  onRevoke,
  assignments,
  canInvite = true,
}: {
  evaluators: readonly { userId: string; displayName: string }[];
  scopes: readonly { value: string; label: string }[];
  onInvite(email: string): Promise<ActionOutcome>;
  onAssign(input: { evaluatorUserId: string; scope: string }): Promise<ActionOutcome>;
  onRevoke(assignmentId: string): Promise<ActionOutcome>;
  assignments: readonly ManageableAssignment[];
  canInvite?: boolean;
}) {
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [invitationDelivery, setInvitationDelivery] = useState<
    'manual_share' | 'notifier_enqueued' | null
  >(null);
  const [revokedAssignmentIds, setRevokedAssignmentIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
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
              if (
                (result.outcome === 'manual_share' || result.outcome === 'notifier_enqueued') &&
                result.shareUrl
              ) {
                setShareUrl(result.shareUrl);
                setInvitationDelivery(result.outcome);
                setMessage(
                  result.outcome === 'manual_share'
                    ? 'Invitation created. Email was not sent.'
                    : 'Invitation created and delivery was queued.',
                );
              } else {
                setMessage('The invitation could not be created.');
              }
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
            Create invitation link
          </button>
          {shareUrl ? (
            <section className="grid gap-3 rounded-lg border border-[var(--color-border)] p-4">
              <p className="font-semibold">One-time invitation link</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                {invitationDelivery === 'manual_share'
                  ? 'Email was not sent. Share this expiring link securely. It will disappear if you reload or create another invitation.'
                  : 'Delivery was queued. This expiring link is available only for secure delivery recovery and will disappear if you reload or create another invitation.'}
              </p>
              <label className="grid gap-2 text-sm font-medium">
                One-time invitation link
                <input
                  className="min-h-11 min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
                  readOnly
                  value={shareUrl}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="button-secondary min-h-11"
                  onClick={() => {
                    void (async () => {
                      try {
                        if (!navigator.clipboard) throw new Error('clipboard unavailable');
                        await navigator.clipboard.writeText(shareUrl);
                        setMessage('Invitation link copied.');
                      } catch {
                        setMessage('Copy failed. The invitation link remains available above.');
                      }
                    })();
                  }}
                  type="button"
                >
                  Copy invitation link
                </button>
                <a
                  className="button-secondary inline-flex min-h-11 items-center"
                  href={shareUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open invitation link
                </a>
              </div>
            </section>
          ) : null}
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
      <section className="card min-w-0 p-5 xl:col-span-2" aria-labelledby="active-grants-heading">
        <p className="eyebrow">Current access</p>
        <h3 className="text-lg font-semibold" id="active-grants-heading">
          Active evaluator grants
        </h3>
        {assignments.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            No manageable active grants.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {assignments
              .filter((assignment) => !revokedAssignmentIds.has(assignment.assignmentId))
              .map((assignment) => (
                <li
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--color-border)] p-4 sm:flex-row sm:items-center sm:justify-between"
                  key={assignment.assignmentId}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{assignment.evaluatorName}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {assignment.scopeLabel}
                    </p>
                  </div>
                  <button
                    aria-label={`Revoke ${assignment.evaluatorName} from ${assignment.scopeLabel}`}
                    className="button-secondary min-h-11"
                    disabled={pending}
                    onClick={() => {
                      startTransition(async () => {
                        const result = await onRevoke(assignment.assignmentId);
                        if (result.outcome === 'revoked') {
                          setRevokedAssignmentIds(
                            (current) => new Set([...current, assignment.assignmentId]),
                          );
                        }
                        setMessage(
                          result.outcome === 'revoked'
                            ? 'Evaluator access revoked and recorded in the audit log.'
                            : result.outcome === 'forbidden'
                              ? 'You are not authorized to revoke that evaluator grant.'
                              : 'The evaluator grant could not be revoked.',
                        );
                      });
                    }}
                    type="button"
                  >
                    Revoke access
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
      <p
        role={message.includes('failed') ? 'alert' : undefined}
        aria-live="polite"
        className="min-h-6 text-sm text-[var(--color-text-muted)] xl:col-span-2"
      >
        {message}
      </p>
    </div>
  );
}
