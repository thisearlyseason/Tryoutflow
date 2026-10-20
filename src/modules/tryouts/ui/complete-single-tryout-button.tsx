'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useActionState } from 'react';
import { completeSingleTryoutAction } from '../application/complete-single-tryout-action';

export function CompleteSingleTryoutButton({
  organizationSlug,
  tryoutId,
  expectedVersion,
}: {
  organizationSlug: string;
  tryoutId: string;
  expectedVersion: number;
}) {
  const [state, action, pending] = useActionState(
    completeSingleTryoutAction.bind(null, organizationSlug, tryoutId, expectedVersion),
    null,
  );
  if (state?.completed)
    return <p role="status">Tryout completed and locked. Your results are preserved.</p>;
  return (
    <form action={action} className="card space-y-3 p-5">
      <h2 className="text-lg font-bold">Finished this tryout?</h2>
      <p className="text-sm">
        This permanently locks all event changes, including scores, registrations, rosters and new
        messages. Results stay available to view and export.
      </p>
      <label className="flex items-start gap-3 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          name="confirm"
          value="yes"
          required
          disabled={pending}
        />
        I have finished scores, selections and messages. I understand this cannot be undone.
      </label>
      <FeedbackButton busy={pending} className="button-primary" type="submit" disabled={pending}>
        {pending ? 'Locking tryout…' : 'Complete & lock tryout'}
      </FeedbackButton>
      {state?.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
