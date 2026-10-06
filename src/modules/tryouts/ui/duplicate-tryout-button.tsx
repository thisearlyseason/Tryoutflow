'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useActionState } from 'react';
import { duplicateTryoutAction } from '../application/duplicate-tryout-action';

export function DuplicateTryoutButton({
  organizationSlug,
  tryoutId,
}: {
  organizationSlug: string;
  tryoutId: string;
}) {
  const [state, action, pending] = useActionState(
    duplicateTryoutAction.bind(null, organizationSlug, tryoutId),
    null,
  );
  return (
    <form action={action}>
      <FeedbackButton busy={pending} className="button-secondary" type="submit" disabled={pending}>
        {pending ? 'Duplicating…' : 'Duplicate tryout'}
      </FeedbackButton>
      {state?.error ? (
        <p className="mt-2 text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
