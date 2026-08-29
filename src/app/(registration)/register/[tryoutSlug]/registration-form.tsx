'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import {
  RegistrationFormSchema,
  type RegistrationFormSchema as FormSchema,
} from '../../../../modules/registration/domain/form-schema';

type RegistrationTryout = {
  name: string;
  formSchema: FormSchema;
  divisions: { id: string; name: string }[];
};

export function RegistrationForm({ tryoutSlug }: { tryoutSlug: string }) {
  const [tryout, setTryout] = useState<RegistrationTryout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/public/registrations?tryoutSlug=${encodeURIComponent(tryoutSlug)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('closed');
        const body = (await response.json()) as { tryout: RegistrationTryout };
        setTryout({
          ...body.tryout,
          formSchema: RegistrationFormSchema.parse(body.tryout.formSchema),
        });
      })
      .catch(() => setError('This registration is unavailable or closed.'));
  }, [tryoutSlug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tryout) return;
    const fields = new FormData(event.currentTarget);
    const responses: Record<string, unknown> = {};
    for (const field of tryout.formSchema.fields) {
      const value = fields.get(field.key);
      responses[field.key] =
        field.kind === 'consent' || field.kind === 'checkbox' ? value === 'on' : value;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/public/registrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tryoutSlug,
          idempotencyKey:
            crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
          submission: {
            givenName: fields.get('givenName'),
            familyName: fields.get('familyName'),
            birthDate: fields.get('birthDate'),
            divisionId: fields.get('divisionId') || undefined,
            guardian: { name: fields.get('guardianName'), email: fields.get('guardianEmail') },
            responses,
          },
        }),
      });
      if (!response.ok) throw new Error('failed');
      window.location.assign(`/register/${encodeURIComponent(tryoutSlug)}/confirmation`);
    } catch {
      setError('We could not submit your registration. Review the form and try again.');
      setBusy(false);
    }
  }

  if (error && !tryout)
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1>Registration unavailable</h1>
        <p role="alert">{error}</p>
      </main>
    );
  if (!tryout)
    return (
      <main className="mx-auto max-w-xl p-6">
        <p aria-live="polite">Loading registration…</p>
      </main>
    );

  return (
    <main className="mx-auto max-w-xl p-4 sm:p-6">
      <h1 className="text-2xl font-bold">Register for {tryout.name}</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">
        A guardian must complete this form. We collect only what this tryout needs.
      </p>
      <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
        <label>
          {' '}
          Athlete first name{' '}
          <Input
            name="givenName"
            aria-label="Athlete first name"
            required
            autoComplete="given-name"
          />{' '}
        </label>
        <label>
          {' '}
          Athlete last name{' '}
          <Input
            name="familyName"
            aria-label="Athlete last name"
            required
            autoComplete="family-name"
          />{' '}
        </label>
        <label>
          {' '}
          Date of birth{' '}
          <Input name="birthDate" aria-label="Date of birth" type="date" required />{' '}
        </label>
        {tryout.divisions.length > 1 && (
          <label>
            Division
            <select
              className="min-h-[var(--target-mobile)] w-full rounded-[var(--radius-control)] border p-2"
              name="divisionId"
              aria-label="Division"
              required
            >
              {tryout.divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {' '}
          Guardian name{' '}
          <Input name="guardianName" aria-label="Guardian name" required autoComplete="name" />{' '}
        </label>
        <label>
          {' '}
          Guardian email{' '}
          <Input
            name="guardianEmail"
            aria-label="Guardian email"
            type="email"
            required
            autoComplete="email"
          />{' '}
        </label>
        {tryout.formSchema.fields
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((field) => (
            <label key={field.key} className="grid gap-1">
              {field.kind === 'consent' || field.kind === 'checkbox' ? (
                <span>
                  <input
                    name={field.key}
                    aria-label={field.label}
                    type="checkbox"
                    required={field.required}
                  />{' '}
                  {field.label}
                </span>
              ) : (
                <>
                  <span>{field.label}</span>
                  {field.kind === 'select' ? (
                    <select
                      name={field.key}
                      aria-label={field.label}
                      required={field.required}
                      className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border p-2"
                    >
                      <option value="">Select…</option>
                      {field.options?.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      name={field.key}
                      aria-label={field.label}
                      type={
                        field.kind === 'date' ? 'date' : field.kind === 'email' ? 'email' : 'text'
                      }
                      required={field.required}
                    />
                  )}
                </>
              )}
              {field.helpText && (
                <small className="text-[var(--color-text-muted)]">{field.helpText}</small>
              )}
            </label>
          ))}
        {error && <p role="alert">{error}</p>}
        <Button busy={busy} type="submit">
          Submit registration
        </Button>
      </form>
    </main>
  );
}
