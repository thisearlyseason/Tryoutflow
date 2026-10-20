'use client';

import { useActionState } from 'react';

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
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form
      action={formAction}
      className="admin-form mt-4 grid max-w-2xl gap-4 sm:grid-cols-2"
      data-testid="invite-member-form"
    >
      <label className="grid gap-1 font-bold" htmlFor="email">
        Email
        <input
          autoComplete="email"
          className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 font-normal"
          id="email"
          name="email"
          placeholder={FIELD_EXAMPLES.guardianEmail}
          required
          type="email"
        />
      </label>
      <label className="grid gap-1 font-bold" htmlFor="role">
        Role
        <select
          className="min-h-11 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 font-normal"
          defaultValue="member"
          id="role"
          name="role"
        >
          <option value="member">Member</option>
          <option value="administrator">Administrator</option>
        </select>
      </label>
      <Button className="sm:col-span-2 sm:justify-self-start" disabled={pending} type="submit">
        {pending ? 'Creating invitation…' : 'Create invitation'}
      </Button>
      {state.status === 'error' ? (
        <p className="sm:col-span-2" role="alert">
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
