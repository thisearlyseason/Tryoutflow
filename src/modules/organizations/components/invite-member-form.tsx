'use client';

import { useActionState } from 'react';

export type InvitationFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'manual_share' | 'notifier_enqueued'; shareUrl: string };

type InviteMemberFormProps = {
  action: (previousState: InvitationFormState, formData: FormData) => Promise<InvitationFormState>;
};

const initialState: InvitationFormState = { status: 'idle' };

export function InviteMemberForm({ action }: InviteMemberFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction}>
      <label htmlFor="email">Email</label>
      <input autoComplete="email" id="email" name="email" required type="email" />
      <label htmlFor="role">Role</label>
      <select defaultValue="member" id="role" name="role">
        <option value="member">Member</option>
        <option value="administrator">Administrator</option>
      </select>
      <button disabled={pending} type="submit">
        {pending ? 'Creating invitation…' : 'Create invitation'}
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
      {state.status === 'manual_share' || state.status === 'notifier_enqueued' ? (
        <section aria-live="polite">
          <h3>Invitation created</h3>
          <p>
            {state.status === 'notifier_enqueued'
              ? 'Delivery was queued. Keep this one-time link only if you need to recover delivery.'
              : 'Email delivery is not configured yet. Copy and share this one-time invitation link securely.'}
          </p>
          <label htmlFor="invitation-link">One-time invitation link</label>
          <input id="invitation-link" readOnly value={state.shareUrl} />
        </section>
      ) : null}
    </form>
  );
}
