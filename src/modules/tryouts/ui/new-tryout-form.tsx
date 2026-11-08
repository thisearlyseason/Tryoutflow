'use client';

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SavedSetupNavigation } from './saved-setup-navigation';
import { useSetupRecovery } from './use-setup-recovery';
import { SetupRecoveryPanel } from './setup-recovery-panel';
import { recoveryKey, type RecoveryScope } from './setup-recovery-store';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';

type Values = {
  name: string;
  sport: string;
  seasonId: string;
  newSeasonName: string;
  timezone: string;
  registrationStartsAt: string;
  registrationEndsAt: string;
};
export type NewTryoutState =
  | { status: 'idle' }
  | { status: 'created'; href: string }
  | { status: 'error'; message: string; fieldErrors?: Partial<Record<keyof Values, string>> };
export function NewTryoutForm(props: Parameters<typeof NewTryoutFields>[0]) {
  return (
    <NewTryoutFields {...props} key={props.recovery ? recoveryKey(props.recovery) : 'ordinary'} />
  );
}
function NewTryoutFields({
  action,
  seasons,
  defaultSport,
  timezone,
  defaultCycleName,
  recovery: recoveryScope,
}: {
  action: (state: NewTryoutState, data: FormData) => Promise<NewTryoutState>;
  seasons: readonly { id: string; name: string }[];
  defaultSport: string;
  timezone: string;
  defaultCycleName: string;
  recovery?: RecoveryScope;
}) {
  const [values, setValues] = useState<Values>({
    name: '',
    sport: defaultSport,
    seasonId: seasons[0]?.id ?? '',
    newSeasonName: defaultCycleName,
    timezone,
    registrationStartsAt: '',
    registrationEndsAt: '',
  });
  const recovery = useSetupRecovery(recoveryScope, values, (fields) =>
    setValues((old) => ({ ...old, ...fields })),
  );
  const [state, formAction, pending] = useActionState<NewTryoutState, FormData>(
    async (previous, data) => {
      const ticket = await recovery.beforeSubmit();
      const result = await action(previous, data);
      if (result.status === 'created') await recovery.complete(ticket);
      return result;
    },
    { status: 'idle' },
  );
  const alert = useRef<HTMLParagraphElement>(null);
  const cycleSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (state.status === 'error') {
      // React resets native selects when an action resolves, including recoverable errors.
      if (cycleSelect.current) cycleSelect.current.value = values.seasonId;
    }
  }, [state, values.seasonId]);
  useEffect(() => {
    if (state.status === 'error') alert.current?.focus();
  }, [state]);
  const errors = state.status === 'error' ? (state.fieldErrors ?? {}) : {};
  const field = (key: keyof Values) => ({
    value: values[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setValues((old) => ({ ...old, [key]: event.target.value })),
    'aria-invalid': Boolean(errors[key]) || undefined,
  });
  if (state.status === 'created')
    return <SavedSetupNavigation href={state.href} message="Your draft is saved." />;
  return (
    <form
      action={formAction}
      className="workspace-card grid gap-5"
      aria-busy={pending || undefined}
    >
      {recoveryScope && (
        <SetupRecoveryPanel
          recovery={recovery}
          pending={pending}
          unavailableCycle={Boolean(
            recovery.candidate?.fields.seasonId &&
            !seasons.some((season) => season.id === recovery.candidate?.fields.seasonId),
          )}
        />
      )}
      <fieldset className="contents" disabled={pending || recovery.blocked}>
        <div>
          <p className="eyebrow">Basics</p>
          <h2 id="new-tryout-heading" className="workspace-card-title">
            Start with the essentials
          </h2>
          <p>
            Name your event and choose its sport and season. Your draft will be saved before you add
            divisions and sessions.
          </p>
        </div>
        {state.status === 'error' && (
          <p className="auth-alert" ref={alert} tabIndex={-1} role="alert">
            {state.message}
          </p>
        )}
        <div>
          <label className="block" htmlFor="name">
            <span className="font-bold">Tryout name</span>
            <Input
              id="name"
              name="name"
              required
              maxLength={160}
              placeholder={FIELD_EXAMPLES.tryoutName}
              aria-describedby={errors.name ? 'new-tryout-name-error' : undefined}
              {...field('name')}
            />
          </label>
          {errors.name && (
            <span id="new-tryout-name-error" className="field-error">
              {errors.name}
            </span>
          )}
        </div>
        <label className="block" htmlFor="sport">
          <span className="font-bold">Sport</span>
          <Input
            id="sport"
            name="sport"
            required
            maxLength={80}
            placeholder={defaultSport ? undefined : FIELD_EXAMPLES.sport}
            {...field('sport')}
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="font-bold">Cycle or season</legend>
          <label className="block" htmlFor="seasonId">
            <span>Use an existing cycle</span>
            <select
              className="min-h-11 w-full rounded border px-3"
              ref={cycleSelect}
              id="seasonId"
              name="seasonId"
              value={values.seasonId}
              onChange={(event) => setValues((old) => ({ ...old, seasonId: event.target.value }))}
            >
              <option value="">Create a new cycle</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          {!values.seasonId && (
            <label className="block" htmlFor="newSeasonName">
              <span>New cycle name</span>
              <Input
                id="newSeasonName"
                name="newSeasonName"
                required
                maxLength={120}
                placeholder={FIELD_EXAMPLES.season}
                {...field('newSeasonName')}
              />
            </label>
          )}
          <p className="text-sm text-[var(--color-text-muted)]">
            A cycle groups related tryouts, such as one season. Choose an existing cycle or create
            one.
          </p>
        </fieldset>
        <div>
          <label className="block" htmlFor="timezone">
            <span className="font-bold">Timezone</span>
            <Input
              id="timezone"
              name="timezone"
              required
              aria-describedby="new-tryout-timezone-help"
              {...field('timezone')}
            />
          </label>
          <span
            className="mt-1 block text-sm text-[var(--color-text-muted)]"
            id="new-tryout-timezone-help"
          >
            Dates use this timezone. Your organization’s default is {timezone}.
          </span>
        </div>
        <div className="rounded-lg bg-[var(--color-surface-muted)] p-3">
          <h3>Registration window (optional)</h3>
          <p>
            These dates control when athletes can register. Set the actual tryout event dates in
            Sessions after creating the draft.
          </p>
        </div>
        <div>
          <label className="block" htmlFor="registrationStartsAt">
            <span className="font-bold">Registration opens</span>
            <Input
              id="registrationStartsAt"
              name="registrationStartsAt"
              type="datetime-local"
              aria-describedby="new-tryout-registration-opens-help"
              {...field('registrationStartsAt')}
            />
          </label>
          <span
            className="mt-1 block text-sm text-[var(--color-text-muted)]"
            id="new-tryout-registration-opens-help"
          >
            Example: September 15, 2026 at 6:00 PM in {values.timezone}.
          </span>
        </div>
        <div>
          <label className="block" htmlFor="registrationEndsAt">
            <span className="font-bold">Registration closes</span>
            <Input
              id="registrationEndsAt"
              name="registrationEndsAt"
              type="datetime-local"
              aria-describedby={`new-tryout-registration-closes-help${errors.registrationEndsAt ? ' new-tryout-close-error' : ''}`}
              {...field('registrationEndsAt')}
            />
          </label>
          <span
            className="mt-1 block text-sm text-[var(--color-text-muted)]"
            id="new-tryout-registration-closes-help"
          >
            Example: September 30, 2026 at 6:00 PM in {values.timezone}.
          </span>
          {errors.registrationEndsAt && (
            <span className="field-error" id="new-tryout-close-error">
              {errors.registrationEndsAt}
            </span>
          )}
        </div>
        <Button type="submit" busy={pending}>
          Create draft
        </Button>
      </fieldset>
    </form>
  );
}
