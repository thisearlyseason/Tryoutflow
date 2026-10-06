'use client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { normalizeOrganizationSlug } from '../domain/organization';
export type CreateTeamState = { error?: string };
export function CreateTeamWorkspaceForm({
  action,
  parentSlug,
}: {
  action: (state: CreateTeamState, data: FormData) => Promise<CreateTeamState>;
  parentSlug: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [customSlug, setCustomSlug] = useState(false);
  return (
    <form action={formAction} className="workspace-card grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <h2 className="text-xl font-bold">Create a team workspace</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Give each team its own coaches, athletes and tryouts. Your Organization plan covers every
          team.
        </p>
      </div>
      <label className="grid gap-2 font-bold">
        Team name
        <input
          className="min-h-11 rounded-lg border px-3 font-normal"
          name="name"
          required
          maxLength={160}
          placeholder="U13 Falcons"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!customSlug)
              setSlug(
                normalizeOrganizationSlug(`${parentSlug.slice(0, 35)}-${event.target.value}`)
                  .slice(0, 63)
                  .replace(/-$/, ''),
              );
          }}
        />
      </label>
      <label className="grid gap-2 font-bold">
        Workspace address
        <input
          className="min-h-11 min-w-0 rounded-lg border px-3 font-normal"
          name="slug"
          required
          minLength={3}
          maxLength={63}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          value={slug}
          onChange={(event) => {
            setCustomSlug(true);
            setSlug(event.target.value);
          }}
        />
        <span className="text-xs font-normal text-[var(--color-text-muted)]">
          /app/{slug || 'your-team'}
        </span>
      </label>
      {state.error ? (
        <p role="alert" className="auth-alert sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      <Button className="sm:col-span-2 sm:justify-self-start" disabled={pending} type="submit">
        {pending ? 'Creating workspace…' : 'Create team workspace'}
      </Button>
    </form>
  );
}
