'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '../../../../components/ui/button';
import { FIELD_EXAMPLES } from '../../../../components/forms/field-examples';
import { Input } from '../../../../components/ui/input';
import {
  RegistrationFormSchema,
  type RegistrationFormSchema as FormSchema,
} from '../../../../modules/registration/domain/form-schema';
import { TurnstileClientChallenge } from '../../../../modules/identity/ui/turnstile-client';
import { OrganizationMark } from '../../../../modules/organizations/components/organization-mark';

type RegistrationTryout = {
  name: string;
  formSchema: FormSchema;
  divisions: { id: string; name: string }[];
  positions: { id: string; name: string }[];
};

type RegistrationOrganization = {
  name: string;
  logoUrl?: string;
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
  const [organization, setOrganization] = useState<RegistrationOrganization | null>(null);
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
        const body = (await response.json()) as {
          organization: RegistrationOrganization;
          tryout: RegistrationTryout;
        };
        setOrganization(body.organization);
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
      <main className="registration-page">
        <section className="registration-card">
          <h1>Registration unavailable</h1>
          <p role="alert">This registration is unavailable or closed.</p>
        </section>
      </main>
    );
  if (loadOutcome === 'unavailable' && !tryout)
    return (
      <main className="registration-page">
        <section className="registration-card">
          <h1>Registration temporarily unavailable</h1>
          <p role="alert">{error}</p>
          <Button className="mt-4" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </Button>
        </section>
      </main>
    );
  if (!tryout || !organization)
    return (
      <main className="registration-page">
        <p aria-live="polite" className="registration-card">
          Loading registration…
        </p>
      </main>
    );

  return (
    <main className="registration-page">
      <section className="registration-card">
        <header className="registration-header">
          <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} size={48} />
          <div>
            <p className="eyebrow">{organization.name}</p>
            <h1>Register for {tryout.name}</h1>
            <p>
              Athlete registration. A guardian must complete this form. We collect only what this
              tryout needs.
            </p>
          </div>
        </header>
        <form className="mt-6 grid gap-4" onSubmit={submit} noValidate>
          <label>
            {' '}
            Athlete first name{' '}
            <Input
              name="givenName"
              aria-label="Athlete first name"
              required
              autoComplete="given-name"
              placeholder={FIELD_EXAMPLES.athleteGivenName}
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
              placeholder={FIELD_EXAMPLES.athleteFamilyName}
            />{' '}
          </label>
          <label>
            Guardian phone (optional){' '}
            <Input
              name="guardianPhone"
              aria-label="Guardian phone"
              type="tel"
              autoComplete="tel"
              placeholder={FIELD_EXAMPLES.guardianPhone}
            />
          </label>
          <label>
            {' '}
            Date of birth{' '}
            <Input
              aria-describedby="public-registration-birth-date-help"
              aria-label="Date of birth"
              name="birthDate"
              required
              type="date"
            />{' '}
            <small
              className="block text-[var(--color-text-muted)]"
              id="public-registration-birth-date-help"
            >
              Example: September 15, 2012.
            </small>
          </label>
          {tryout.divisions.length > 1 && (
            <label>
              Division
              <select
                className="min-h-[var(--target-mobile)] w-full rounded-[var(--radius-control)] border p-2"
                name="divisionId"
                aria-label="Division"
                defaultValue=""
                required
              >
                <option disabled value="">
                  Select a division
                </option>
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
            <Input
              name="guardianName"
              aria-label="Guardian name"
              required
              autoComplete="name"
              placeholder={FIELD_EXAMPLES.guardianName}
            />{' '}
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
              placeholder={FIELD_EXAMPLES.guardianEmail}
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
                        defaultValue=""
                        required={field.required}
                        className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border p-2"
                      >
                        <option disabled={field.required} value="">
                          Select {field.label.toLowerCase()}
                        </option>
                        {field.options?.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        name={field.key}
                        aria-label={field.label}
                        aria-describedby={
                          field.kind === 'date'
                            ? `public-registration-${field.key}-help`
                            : undefined
                        }
                        type={
                          field.kind === 'date' ? 'date' : field.kind === 'email' ? 'email' : 'text'
                        }
                        required={field.required}
                      />
                    )}
                  </>
                )}
                {field.kind === 'date' ? (
                  <small
                    className="text-[var(--color-text-muted)]"
                    id={`public-registration-${field.key}-help`}
                  >
                    {field.helpText ? `${field.helpText} ` : null}Example: September 15, 2012.
                  </small>
                ) : field.helpText ? (
                  <small className="text-[var(--color-text-muted)]">{field.helpText}</small>
                ) : null}
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
      </section>
    </main>
  );
}
