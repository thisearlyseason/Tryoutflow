'use client';

import { FeedbackButton } from '@/components/ui/button';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  registrationWindowResponseSchema,
  formatRegistrationDate,
  formatRegistrationTime,
  type RegistrationWindowResponse,
} from '../../../../modules/registration/domain/registration-window';
import { Button } from '../../../../components/ui/button';
import {
  RegistrationFormSchema,
  type RegistrationFormSchema as FormSchema,
} from '../../../../modules/registration/domain/form-schema';
import { TurnstileClientChallenge } from '../../../../modules/identity/ui/turnstile-client';
import { OrganizationMark } from '../../../../modules/organizations/components/organization-mark';

import { RegistrationBuiltInFieldInput } from '../../../../modules/registration/ui/registration-built-in-field';
import { RegistrationCustomField } from '../../../../modules/registration/ui/registration-custom-field';
import { registrationFieldErrors } from '../../../../modules/registration/ui/registration-field-errors';
import {
  REGISTRATION_STEPS,
  RegistrationReview,
  RegistrationStepProgress,
  type RegistrationReviewItem,
  type RegistrationStepIndex,
} from '../../../../modules/registration/ui/registration-steps';
import {
  LEGACY_IDENTITY_FIELDS,
  getOrderedRegistrationFields,
  getBuiltInField,
  type OrderedRegistrationField,
} from '../../../../modules/registration/domain/built-in-fields';

type RegistrationTryout = {
  name: string;
  formSchema: FormSchema;
  formVersionId: string;
  divisions: { id: string; name: string }[];
  positions: { id: string; name: string }[];
};

type RegistrationOrganization = {
  name: string;
  logoUrl?: string;
};

function fieldStep(index: number, fieldCount: number): 0 | 1 {
  return index < Math.max(1, Math.ceil(fieldCount / 2)) ? 0 : 1;
}

function stepForFieldName(fields: OrderedRegistrationField[], name: string): 0 | 1 {
  const index = fields.findIndex((item) => item.field.key === name);
  return fieldStep(index < 0 ? 0 : index, fields.length);
}

function errorsForStep(
  errors: Record<string, string>,
  fields: OrderedRegistrationField[],
  step: RegistrationStepIndex,
) {
  return Object.fromEntries(
    Object.entries(errors).filter(([name]) => stepForFieldName(fields, name) === step),
  );
}

function registrationReviewItems(
  form: HTMLFormElement,
  fields: OrderedRegistrationField[],
): RegistrationReviewItem[] {
  return fields.flatMap((item) => {
    const control = form.elements.namedItem(item.field.key);
    if (!(
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    ))
      return [];
    const value =
      control instanceof HTMLInputElement && control.type === 'checkbox'
        ? control.checked
          ? 'Accepted'
          : 'Not selected'
        : control instanceof HTMLSelectElement
          ? control.selectedOptions[0]?.text || 'Not provided'
          : control.value.trim() || 'Not provided';
    return [{ label: item.field.label, name: item.field.key, value }];
  });
}

export function RegistrationForm({
  tryoutSlug,
  botSiteKey,
  deterministicBotToken,
  testLoaderFailure,
  prefill,
}: {
  tryoutSlug: string;
  botSiteKey?: string;
  deterministicBotToken?: string;
  testLoaderFailure?: string;
  prefill?: Record<string, string>;
}) {
  const [registrationWindow, setRegistrationWindow] = useState<RegistrationWindowResponse | null>(
    null,
  );
  const [tryout, setTryout] = useState<RegistrationTryout | null>(null);
  const [organization, setOrganization] = useState<RegistrationOrganization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [currentStep, setCurrentStep] = useState<RegistrationStepIndex>(0);
  const [reviewItems, setReviewItems] = useState<RegistrationReviewItem[]>([]);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [focusStepAfterTransition, setFocusStepAfterTransition] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const [loadOutcome, setLoadOutcome] = useState<'loading' | 'not_found' | 'unavailable'>(
    'loading',
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [formChanged, setFormChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [challengeResetKey, setChallengeResetKey] = useState(0);
  const [localBotToken, setLocalBotToken] = useState(deterministicBotToken);
  const [botReady, setBotReady] = useState(Boolean(deterministicBotToken));
  const [botVerificationToken, setBotVerificationToken] = useState(deterministicBotToken ?? '');
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
    setFieldErrors({});
    setValidationAttempted(false);
    setCurrentStep(0);
    setReviewItems([]);
    setPendingFocus(null);
    setFocusStepAfterTransition(false);
    setLoadOutcome('loading');
    setRegistrationWindow(null);
    setFormChanged(false);
    setTryout(null);
    const parameters = new URLSearchParams({ tryoutSlug });
    if (loadAttempt === 0 && testLoaderFailure)
      parameters.set('__testLoaderFailure', testLoaderFailure);
    fetch(`/api/public/registrations?${parameters.toString()}`, { cache: 'no-store' })
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
        const window = registrationWindowResponseSchema.safeParse(body);
        if (window.success) {
          setTryout(null);
          setRegistrationWindow(window.data);
          return null;
        }
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

  function focusField(name: string) {
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLElement) {
      field.focus();
      field.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    }
  }

  useEffect(() => {
    if (pendingFocus) {
      focusField(pendingFocus);
      setPendingFocus(null);
      return;
    }
    if (!focusStepAfterTransition) return;
    (currentStep === 2 ? reviewHeadingRef : detailsHeadingRef).current?.focus();
    setFocusStepAfterTransition(false);
  }, [currentStep, focusStepAfterTransition, pendingFocus]);

  function continueFromStep(fields: OrderedRegistrationField[]) {
    const form = formRef.current;
    if (!form || currentStep === 2) return;
    const invalidFields = errorsForStep(registrationFieldErrors(form), fields, currentStep);
    setValidationAttempted(true);
    setFieldErrors(invalidFields);
    const firstInvalid = Object.keys(invalidFields)[0];
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }
    setValidationAttempted(false);
    setError(null);
    if (currentStep === 1) setReviewItems(registrationReviewItems(form, fields));
    setFocusStepAfterTransition(true);
    setCurrentStep((currentStep + 1) as RegistrationStepIndex);
  }

  function backFromStep() {
    setError(null);
    setFieldErrors({});
    setValidationAttempted(false);
    setFocusStepAfterTransition(true);
    setCurrentStep((step) => Math.max(0, step - 1) as RegistrationStepIndex);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tryout || formChanged) return;
    const invalidFields = registrationFieldErrors(event.currentTarget);
    setValidationAttempted(true);
    setFieldErrors(invalidFields);
    if (Object.keys(invalidFields).length > 0) {
      setError(null);
      const firstInvalid = Object.keys(invalidFields)[0]!;
      setCurrentStep(
        stepForFieldName(getOrderedRegistrationFields(tryout.formSchema), firstInvalid),
      );
      setPendingFocus(firstInvalid);
      return;
    }
    setReviewItems(
      registrationReviewItems(event.currentTarget, getOrderedRegistrationFields(tryout.formSchema)),
    );
    setCurrentStep(2);
    const fields = new FormData(event.currentTarget);
    const responses: Record<string, unknown> = {};
    for (const field of tryout.formSchema.fields.filter((field) => field.enabled !== false)) {
      const identityName = LEGACY_IDENTITY_FIELDS[field.key];
      const value = fields.get(identityName ?? field.key);
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
          formVersionId: tryout.formVersionId,
          botVerificationToken: botVerificationToken || fields.get('cf-turnstile-response'),
          idempotencyKey: stableIdempotencyKey(),
          submission: {
            givenName: fields.get('givenName'),
            familyName: fields.get('familyName'),
            birthDate: fields.get('birthDate') || undefined,
            divisionId: fields.get('divisionId') || undefined,
            positionId: fields.get('positionId') || undefined,
            guardianName: fields.get('guardianName') || undefined,
            guardianEmail: fields.get('guardianEmail'),
            guardianPhone: fields.get('guardianPhone') || undefined,
            responses,
          },
        }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setFormChanged(true);
          throw new Error('form_changed');
        }
        if (response.status === 429) throw new Error('rate_limited');
        if (response.status === 400) throw new Error('invalid');
        throw new Error('failed');
      }
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
    } catch (caught) {
      if (deterministicBotToken) {
        const nextToken = `${deterministicBotToken.split(':')[0]}:${crypto.randomUUID()}`;
        setLocalBotToken(nextToken);
        setBotVerificationToken(nextToken);
      } else {
        setBotReady(false);
        setBotVerificationToken('');
      }
      setChallengeResetKey((value) => value + 1);
      setError(
        caught instanceof Error && caught.message === 'form_changed'
          ? 'The waiver or registration form has changed. Reload the form and review the current terms before submitting.'
          : caught instanceof Error && caught.message === 'rate_limited'
            ? 'Too many registration attempts. Please wait a few minutes and try again.'
            : caught instanceof Error && caught.message === 'invalid'
              ? 'Please review the required fields and try again.'
              : 'We could not submit your registration right now. Please try again.',
      );
      setBusy(false);
    }
  }

  if (registrationWindow) {
    const { outcome, registrationWindow: window } = registrationWindow;
    const opens = formatRegistrationDate(window.opensAt, window.timezone);
    const closes = formatRegistrationDate(window.closesAt, window.timezone);
    return (
      <main className="registration-page">
        <section className="registration-card">
          <p className="eyebrow">
            {window.organizationName} · {window.name}
          </p>
          <h1>{outcome === 'scheduled' ? `Registration opens ${opens}` : 'Registration closed'}</h1>
          <p className="mt-4" role="status">
            {outcome === 'scheduled'
              ? `Registration opens at ${formatRegistrationTime(window.opensAt, window.timezone)} on ${opens} and closes at ${formatRegistrationTime(window.closesAt, window.timezone)} on ${closes}.`
              : `Registration closed at ${formatRegistrationTime(window.closesAt, window.timezone)} on ${closes}.`}{' '}
            All times use {window.timezone}.
          </p>
          <p className="mt-3">
            {outcome === 'scheduled'
              ? 'Return during the registration window to complete the form.'
              : 'Contact the organizer if you need help with a late registration.'}
          </p>
          <Button className="mt-4" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Check registration availability
          </Button>
        </section>
      </main>
    );
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

  const orderedFields = getOrderedRegistrationFields(tryout.formSchema);
  const visibleFieldErrors = errorsForStep(fieldErrors, orderedFields, currentStep);

  return (
    <main className="registration-page">
      <section className="registration-card">
        <header className="registration-header">
          <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} size={48} />
          <div>
            <p className="eyebrow">{organization.name}</p>
            <h1>Register for {tryout.name}</h1>
            <p>Complete each short step, then review the registration before submitting.</p>
          </div>
        </header>
        <RegistrationStepProgress currentStep={currentStep} />
        <form
          ref={formRef}
          className="mt-6 grid gap-6"
          onSubmit={submit}
          onChange={(event) => {
            if (validationAttempted) setFieldErrors(registrationFieldErrors(event.currentTarget));
          }}
          noValidate
        >
          {Object.keys(visibleFieldErrors).length > 0 ? (
            <div
              role="alert"
              className="rounded-[var(--radius-surface)] border border-[var(--color-destructive)] bg-[var(--color-destructive-surface)] p-4 text-[var(--color-destructive)]"
            >
              <p className="font-bold">Please complete or correct the highlighted fields.</p>
              <ul className="mt-2 list-inside list-disc">
                {Object.keys(visibleFieldErrors).map((name) => (
                  <li key={name}>
                    <FeedbackButton
                      type="button"
                      className="min-h-11 text-left underline"
                      onClick={() => focusField(name)}
                    >
                      {orderedFields.find((item) => item.field.key === name)?.field.label ?? name}
                    </FeedbackButton>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <section hidden={currentStep === 2} aria-labelledby={`registration-step-${currentStep}`}>
            <div className="mb-5">
              <p className="eyebrow">Registration details</p>
              <h2
                ref={detailsHeadingRef}
                id={`registration-step-${currentStep}`}
                className="mt-1 text-2xl font-bold"
                tabIndex={-1}
              >
                {REGISTRATION_STEPS[currentStep].title}
              </h2>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                {REGISTRATION_STEPS[currentStep].description}
              </p>
            </div>
            {prefill && (
              <p className="mb-4 text-sm">
                Identity details were filled from your linked athlete profile. Review them before
                submitting.
              </p>
            )}
            <div className="grid gap-4">
              {orderedFields.map((item, index) => (
                <div
                  key={`${item.type}-${item.field.key}`}
                  hidden={fieldStep(index, orderedFields.length) !== currentStep}
                >
                  {item.type === 'builtIn' ? (
                    <RegistrationBuiltInFieldInput
                      field={item.field}
                      error={fieldErrors[item.field.key]}
                      defaultValue={prefill?.[item.field.key]}
                      divisions={tryout.divisions}
                      positions={tryout.positions}
                    />
                  ) : (
                    <RegistrationCustomField
                      field={item.field}
                      error={fieldErrors[item.field.key]}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
          <div hidden={currentStep !== 2}>
            <RegistrationReview headingRef={reviewHeadingRef} items={reviewItems} />
          </div>
          <TurnstileClientChallenge
            action="public_registration"
            deterministicToken={localBotToken}
            resetKey={challengeResetKey}
            onReadyChange={setBotReady}
            onTokenChange={setBotVerificationToken}
            siteKey={botSiteKey}
          />
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
            {currentStep > 0 ? (
              <Button type="button" variant="secondary" onClick={backFromStep}>
                Back
              </Button>
            ) : (
              <span />
            )}
            {currentStep < 2 ? (
              <Button type="button" onClick={() => continueFromStep(orderedFields)}>
                {currentStep === 1 ? 'Continue to review' : 'Continue'}
              </Button>
            ) : (
              <div className="flex flex-wrap gap-3">
                {formChanged ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                  >
                    Reload form
                  </Button>
                ) : null}
                <Button
                  busy={busy}
                  disabled={
                    !botReady ||
                    formChanged ||
                    (Boolean(
                      getBuiltInField(tryout.formSchema, 'positionId')?.enabled &&
                      getBuiltInField(tryout.formSchema, 'positionId')?.required,
                    ) &&
                      tryout.positions.length === 0)
                  }
                  type="submit"
                >
                  Submit registration
                </Button>
              </div>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
