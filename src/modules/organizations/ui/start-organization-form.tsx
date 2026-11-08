'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { normalizeOrganizationSlug } from '../domain/organization';
import { TimezonePicker } from './timezone-picker';

export type StartOrganizationState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: Partial<Record<'name' | 'slug' | 'timezone', string>>;
    };
export function StartOrganizationForm({
  action,
  plan,
}: {
  action: (state: StartOrganizationState, data: FormData) => Promise<StartOrganizationState>;
  plan?: 'pro';
}) {
  const [state, formAction, pending] = useActionState<StartOrganizationState, FormData>(action, {
    status: 'idle',
  });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [customAddress, setCustomAddress] = useState(false);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === 'error') alert.current?.focus();
  }, [state]);
  const errors = state.status === 'error' ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={formAction} aria-busy={pending || undefined}>
      {plan && <input type="hidden" name="plan" value={plan} />}
      {state.status === 'error' && (
        <p ref={alert} tabIndex={-1} role="alert" className="auth-alert">
          {state.message}
        </p>
      )}
      <FormField htmlFor="name" label="Organization name" required error={errors.name}>
        {({ describedBy, invalid }) => (
          <Input
            id="name"
            name="name"
            placeholder={FIELD_EXAMPLES.organizationName}
            required
            maxLength={160}
            value={name}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              const value = event.target.value;
              setName(value);
              if (!customAddress) {
                const suggested = normalizeOrganizationSlug(value).slice(0, 63).replace(/-$/u, '');
                setSlug(suggested && suggested.length < 3 ? `${suggested}-team` : suggested);
              }
            }}
          />
        )}
      </FormField>
      <FormField
        htmlFor="slug"
        label="Your TryoutFlow workspace address"
        required
        error={errors.slug}
        description="We suggest an address from your name. You can edit it. This is your internal workspace address, not your public website."
      >
        {({ describedBy, invalid }) => (
          <Input
            id="slug"
            name="slug"
            placeholder="badlands-hockey-academy"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={3}
            maxLength={63}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              setCustomAddress(true);
              setSlug(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField
        htmlFor="timezone"
        label="Timezone"
        required
        error={errors.timezone}
        description="Start typing to search timezones. We select your device timezone when it is available."
      >
        {({ describedBy }) => <TimezonePicker describedBy={describedBy} />}
      </FormField>
      <p className="text-sm text-[var(--color-text-muted)]">
        Next, you’ll create a tryout draft. You can review publishing access when you are ready.
      </p>
      <Button className="mt-2 w-full" type="submit" busy={pending}>
        Create organization
      </Button>
    </form>
  );
}
