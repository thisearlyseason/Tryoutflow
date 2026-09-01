'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import {
  RegistrationFormSchema,
  type RegistrationFormSchema as FormSchema,
} from '../../../../modules/registration/domain/form-schema';
import { TurnstileClientChallenge } from '../../../../modules/identity/ui/turnstile-client';

type RegistrationTryout = {
  name: string;
  formSchema: FormSchema;
  divisions: { id: string; name: string }[];
  positions: { id: string; name: string }[];
};

export function RegistrationForm({
  tryoutSlug,
  botSiteKey,
  deterministicBotToken,
  testLoaderFailure,
}: {
  tryoutSlug: string;
  botSiteKey?: string;
  deterministicBotToken?: string;
  testLoaderFailure?: string;
}) {
  const [tryout, setTryout] = useState<RegistrationTryout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadOutcome, setLoadOutcome] = useState<'loading' | 'not_found' | 'unavailable'>(
    'loading',
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  function stableIdempotencyKey() {
    if (idempotencyKey.current) return idempotencyKey.current;
    const storageKey = `tryoutflow:registration:${tryoutSlug}:idempotency`;
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(storageKey);
    } catch {
      // A private/blocked storage context still gets an in-memory retry key.
    }
    idempotencyKey.current =
      stored ??
      `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
    try {
      window.sessionStorage.setItem(storageKey, idempotencyKey.current);
    } catch {
      // The ref preserves stability for the current mounted form.
    }
    return idempotencyKey.current;
  }

  useEffect(() => {
    setError(null);
    setLoadOutcome('loading');
    const parameters = new URLSearchParams({ tryoutSlug });
    if (loadAttempt === 0 && testLoaderFailure)
      parameters.set('__testLoaderFailure', testLoaderFailure);
    fetch(`/api/public/registrations?${parameters.toString()}`)
      .then(async (response) => {
        if (response.status === 404) {
          setLoadOutcome('not_found');
          return null;
        }
        if (!response.ok) throw new Error('unavailable');
        const body = (await response.json()) as { tryout: RegistrationTryout };
        setTryout({
          ...body.tryout,
          formSchema: RegistrationFormSchema.parse(body.tryout.formSchema),
        });
        return body;
      })
      .catch(() => {
        setError('Registration configuration could not be loaded. No registration was changed.');
        setLoadOutcome('unavailable');
      });
  }, [loadAttempt, testLoaderFailure, tryoutSlug]);

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
          botVerificationToken: fields.get('cf-turnstile-response'),
          idempotencyKey: stableIdempotencyKey(),
          submission: {
            givenName: fields.get('givenName'),
            familyName: fields.get('familyName'),
            birthDate: fields.get('birthDate'),
            divisionId: fields.get('divisionId') || undefined,
            positionId: fields.get('positionId') || undefined,
            guardianName: fields.get('guardianName'),
            guardianEmail: fields.get('guardianEmail'),
            guardianPhone: fields.get('guardianPhone') || undefined,
            responses,
          },
        }),
      });
      if (!response.ok) throw new Error('failed');
      const result = (await response.json()) as {
        delivery?: 'queued' | 'not_configured' | 'not_attempted';
        manualConfirmationToken?: string;
      };
      if (result.manualConfirmationToken) {
        try {
          window.sessionStorage.setItem(
            'tryoutflow:registration:confirmation',
            JSON.stringify({ token: result.manualConfirmationToken, tryoutSlug }),
          );
        } catch {
          // Submission succeeded; the confirmation page will show recovery guidance.
        }
      }
      if (result.delivery === 'queued') {
        try {
          window.sessionStorage.setItem('tryoutflow:registration:email-queued', tryoutSlug);
        } catch {
          // The destination page still provides conservative recovery guidance.
        }
      }
      try {
        window.sessionStorage.removeItem(`tryoutflow:registration:${tryoutSlug}:idempotency`);
      } catch {
        // Nothing else depends on cleanup succeeding.
      }
      window.location.assign(`/register/${encodeURIComponent(tryoutSlug)}/confirmation`);
    } catch {
      setError('We could not submit your registration. Review the form and try again.');
      setBusy(false);
    }
  }

  if (loadOutcome === 'not_found' && !tryout)
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1>Registration unavailable</h1>
        <p role="alert">This registration is unavailable or closed.</p>
      </main>
    );
  if (loadOutcome === 'unavailable' && !tryout)
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1>Registration temporarily unavailable</h1>
        <p role="alert">{error}</p>
        <Button className="mt-4" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          Retry
        </Button>
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
          Guardian phone (optional){' '}
          <Input name="guardianPhone" aria-label="Guardian phone" type="tel" autoComplete="tel" />
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
        {tryout.positions.length > 0 && (
          <label>
            Position (optional)
            <select
              className="min-h-[var(--target-mobile)] w-full rounded-[var(--radius-control)] border p-2"
              name="positionId"
              aria-label="Position"
            >
              <option value="">Unassigned</option>
              {tryout.positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
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
        {[...tryout.formSchema.fields]
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
                    className="min-h-[var(--target-mobile)] min-w-[var(--target-mobile)]"
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
        <TurnstileClientChallenge
          action="public_registration"
          deterministicToken={deterministicBotToken}
          siteKey={botSiteKey}
        />
        <Button busy={busy} type="submit">
          Submit registration
        </Button>
      </form>
    </main>
  );
}
