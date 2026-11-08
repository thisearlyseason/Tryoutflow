'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';

import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { Button } from '../../../components/ui/button';

export type InvitationFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'manual_share' | 'notifier_enqueued'; shareUrl: string; expiresAt: string };

type InviteMemberFormProps = {
  action: (previousState: InvitationFormState, formData: FormData) => Promise<InvitationFormState>;
};

const initialState: InvitationFormState = { status: 'idle' };

export function InviteMemberForm({ action }: InviteMemberFormProps) {
  const [, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: InvitationFormState, data: FormData): Promise<InvitationFormState> => {
      try {
        const result = await action(previous, data);
        if (result.status === 'manual_share' || result.status === 'notifier_enqueued') {
          setEmail('');
          setRole('member');
        }
        return result;
      } catch (error) {
        unstable_rethrow(error);
        return {
          status: 'error',
          message:
            'We could not confirm this invitation. Your entries are still here. Check Invitations in another tab before trying again.',
        };
      }
    },
    initialState,
  );
  useEffect(() => {
    if (!pending && state.status === 'error') errorRef.current?.focus();
  }, [pending, state]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
      aria-busy={pending}
      className="admin-form mt-4 grid max-w-2xl gap-4 sm:grid-cols-2"
      data-testid="invite-member-form"
    >
      <fieldset disabled={pending} className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="sr-only">Invitation details</legend>
        <label className="grid gap-1 font-bold" htmlFor="email">
          Email
          <input
            autoComplete="email"
            className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 font-normal"
            id="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={FIELD_EXAMPLES.guardianEmail}
            required
            type="email"
          />
        </label>
        <label className="grid gap-1 font-bold" htmlFor="role">
          Role
          <select
            className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 font-normal"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            id="role"
            name="role"
          >
            <option value="member">Member</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
      </fieldset>
      <Button className="sm:col-span-2 sm:justify-self-start" disabled={pending} type="submit">
        {pending ? 'Creating invitation…' : 'Create invitation'}
      </Button>
      {!pending && state.status === 'error' ? (
        <p ref={errorRef} tabIndex={-1} className="sm:col-span-2" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === 'manual_share' || state.status === 'notifier_enqueued' ? (
        <section
          aria-live="polite"
          className="rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 sm:col-span-2"
        >
          <h3>Invitation created</h3>
          <p>
            {state.status === 'notifier_enqueued'
              ? 'Delivery was queued. Keep this one-time link only if you need to recover delivery.'
              : 'Email delivery is not configured yet. Copy and share this one-time invitation link securely.'}
          </p>
          <label htmlFor="invitation-link">One-time invitation link</label>
          <input
            className="mt-1 min-h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border)] px-3"
            id="invitation-link"
            readOnly
            value={state.shareUrl}
          />
          <p>
            Expires{' '}
            <time dateTime={state.expiresAt}>
              {new Intl.DateTimeFormat('en-US', {
                dateStyle: 'long',
                timeStyle: 'short',
                timeZone: 'UTC',
              }).format(new Date(state.expiresAt))}{' '}
              UTC
            </time>
          </p>
        </section>
      ) : null}
    </form>
  );
}
