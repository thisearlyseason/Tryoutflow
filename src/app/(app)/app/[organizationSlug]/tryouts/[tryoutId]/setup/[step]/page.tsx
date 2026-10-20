import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { loadSingleTryoutLifecycle } from '@/modules/tryouts/application/single-tryout-lifecycle';
import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import { RegistrationFormSchema } from '@/modules/registration/domain/form-schema';
import { notFound, redirect } from 'next/navigation';
import { setupConfigurationSchema } from '@/modules/tryouts/domain/setup-configuration';

import { ErrorState } from '@/components/feedback/error-state';
import { PageHeader } from '@/components/layout/page-header';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';
import { AppError } from '@/modules/observability/domain/app-error';
import {
  publishTryout,
  validateTryoutForPublish,
} from '@/modules/tryouts/application/publish-tryout';
import {
  saveTryoutSetupStep,
  tryoutSetupSteps,
  type TryoutSetupStep,
} from '@/modules/tryouts/application/save-tryout-setup-step';
import {
  saveWizardConfiguration,
  wizardPayload,
} from '@/modules/tryouts/application/save-wizard-configuration';
import { persistWizardStep } from '@/modules/tryouts/application/persist-wizard-step';
import { prepareWizardSaveAttempt } from '@/modules/tryouts/application/prepare-wizard-save-attempt';
import { TryoutWizard, type TryoutWizardActionState } from '@/modules/tryouts/ui/tryout-wizard';
import { parseTryoutBasics } from '@/modules/tryouts/ui/tryout-basics';
import { WizardProgress } from '@/modules/tryouts/ui/wizard-progress';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function TryoutSetupStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string; step: string }>;
  searchParams: Promise<{
    error?: string | string[];
    saved?: string | string[];
    new?: string | string[];
    selected?: string | string[];
  }>;
}) {
  const { organizationSlug, step: rawStep, tryoutId } = await params;
  const {
    error: rawError,
    saved: rawSaved,
    new: rawNew,
    selected: rawSelected,
  } = await searchParams;
  const error = typeof rawError === 'string' ? rawError : undefined;
  const selectedId = typeof rawSelected === 'string' ? rawSelected : undefined;
  const saved = rawSaved === '1';
  if (!tryoutSetupSteps.includes(rawStep as TryoutSetupStep)) notFound();
  const step = rawStep as TryoutSetupStep;
  const current = await requireCurrentOrganization(organizationSlug);
  if (step === 'rubrics') {
    const upgrade = await billingUpgradePrompt(
      current.organization.id,
      organizationSlug,
      'custom_templates',
      tryoutId,
    );
    if (upgrade) return upgrade;
  }
  const tryoutResult = await current.client
    .from('tryouts')
    .select(
      'id, name, sport, timezone, registration_starts_at, registration_ends_at, status, version',
    )
    .eq('organization_id', current.organization.id)
    .eq('id', tryoutId)
    .maybeSingle();
  if (tryoutResult.error) {
    captureOperationalError(tryoutResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'tryout_setup.load',
    });
    return (
      <ErrorState
        description="Tryout setup could not be loaded. Refresh before making changes."
        title="Setup temporarily unavailable"
      />
    );
  }
  const tryout = tryoutResult.data;
  if (!tryout) notFound();
  const lifecycle = await loadSingleTryoutLifecycle(
    current.client,
    current.organization.id,
    tryoutId,
  );
  if (
    lifecycle.locked ||
    (lifecycle.sealed && ['basics', 'divisions', 'sessions'].includes(step))
  ) {
    return (
      <section className="card space-y-3 p-5">
        <h2 className="text-xl font-bold">
          {lifecycle.locked
            ? 'This tryout is read-only'
            : 'This event’s identity and schedule are fixed'}
        </h2>
        <p>
          {lifecycle.locked
            ? 'Completed tryouts cannot be changed or reopened. Your results are preserved.'
            : 'A Single Tryout purchase covers this published event. Its name, season, divisions and dates cannot be changed to reuse the license.'}
        </p>
        <Link
          className="button-secondary"
          href={`/app/${organizationSlug}/tryouts/${tryoutId}/overview`}
        >
          Back to overview
        </Link>
      </section>
    );
  }
  const basics = parseTryoutBasics(tryout);
  if (!basics) {
    captureOperationalError(new AppError('unexpected_error'), {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'tryout_setup.load',
    });
    return (
      <ErrorState
        description="Saved tryout details are incomplete. Refresh before making changes."
        title="Setup details unavailable"
      />
    );
  }
  const [progressResult, validation, configurationResult] = await Promise.all([
    current.client
      .from('tryout_setup_progress')
      .select('completed_steps')
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', tryoutId)
      .maybeSingle(),
    validateTryoutForPublish(
      { organizationId: current.organization.id, tryoutId },
      { authorization: current.authorization },
    ),
    current.client.rpc('get_tryout_setup_configuration', {
      p_organization_id: current.organization.id,
      p_tryout_id: tryoutId,
    }),
  ]);
  const loadError = progressResult.error ?? configurationResult.error;
  if (loadError || (!validation.ok && validation.error.code !== 'forbidden')) {
    captureOperationalError(loadError ?? new AppError('unexpected_error'), {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'tryout_setup.load',
    });
    return (
      <ErrorState
        description="Setup details could not be loaded. Refresh before making changes."
        title="Setup temporarily unavailable"
      />
    );
  }
  if (!validation.ok)
    return (
      <section aria-labelledby="setup-denied">
        <h2 id="setup-denied">Setup unavailable</h2>
        <p role="alert">You do not have access to change this tryout.</p>
      </section>
    );
  const progress = progressResult.data;
  const configuration = setupConfigurationSchema.safeParse(configurationResult.data);
  if (!configuration.success)
    return (
      <ErrorState
        title="Setup temporarily unavailable"
        description="Saved setup could not be loaded. Refresh to retry."
      />
    );
  const { divisions, sessions } = configuration.data;
  const blockers = validation.value.blockers;
  const formResult =
    step === 'registration'
      ? await current.client.rpc('get_registration_form_configuration', {
          p_organization_id: current.organization.id,
          p_tryout_id: tryoutId,
        })
      : null;
  const notificationSettings =
    step === 'registration'
      ? await current.client.rpc('get_registration_notification_settings', {
          p_organization_id: current.organization.id,
          p_tryout_id: tryoutId,
        })
      : null;
  if (step === 'registration' && (formResult?.error || notificationSettings?.error))
    return (
      <ErrorState
        title="Registration setup temporarily unavailable"
        description="Saved form settings could not be loaded. Refresh to retry."
      />
    );
  const parsedForm = RegistrationFormSchema.safeParse(formResult?.data?.[0]?.form_schema);
  const registrationForm =
    formResult?.data?.[0] && parsedForm.success
      ? {
          name: formResult.data[0].form_name,
          fields: parsedForm.data.fields,
          builtInFields: parsedForm.data.builtInFields,
          notificationEmail: notificationSettings?.data?.[0]?.notification_email ?? '',
        }
      : undefined;
  async function save(
    _previousState: TryoutWizardActionState,
    formData: FormData,
  ): Promise<TryoutWizardActionState> {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const { fresh, submittedValues } = await prepareWizardSaveAttempt(step, formData, () =>
      route.client
        .from('tryouts')
        .select('id, name, version, status')
        .eq('organization_id', route.organization.id)
        .eq('id', tryoutId)
        .maybeSingle(),
    );
    if (fresh.error) {
      captureOperationalError(fresh.error, {
        actorId: route.userId,
        organizationId: route.organization.id,
        tryoutId,
        operation: 'tryout_setup.save',
      });
      return {
        status: 'form_error',
        message: 'Could not save this step',
        values: submittedValues,
      };
    }
    if (!fresh.data) notFound();
    if (step === 'divisions' && formData.get('intent') === 'continue-existing') {
      if (fresh.data.status !== 'draft')
        redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/setup/sessions`);
      const result = await saveTryoutSetupStep(
        { organizationId: route.organization.id, tryoutId, step },
        { authorization: route.authorization },
      );
      if (!result.ok) return { status: 'form_error', message: 'Could not save this step' };
      redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/setup/sessions`);
    }
    if (fresh.data.status !== 'draft' && (step === 'publish' || step === 'review'))
      redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/overview`);
    if (step === 'publish') {
      if (formData.get('confirmation') !== fresh.data.name)
        redirect(
          `/app/${organizationSlug}/tryouts/${tryoutId}/setup/publish?error=confirmation_required`,
        );
      const result = await publishTryout(
        { organizationId: route.organization.id, tryoutId, expectedVersion: fresh.data.version },
        { authorization: route.authorization },
      );
      if (!result.ok)
        redirect(
          `/app/${organizationSlug}/tryouts/${tryoutId}/setup/publish?error=${result.error.code}`,
        );
      await trackSupabaseWorkflowSafely(route.client, {
        name: 'workflow.completed',
        workflow: 'tryout_setup',
        organizationId: route.organization.id,
        correlationId: createCorrelationId(),
      });
      revalidatePath(`/app/${organizationSlug}/tryouts/${tryoutId}`, 'layout');
      redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/overview`);
    }
    const result = await persistWizardStep(
      {
        organizationId: route.organization.id,
        tryoutId,
        step,
        payload: wizardPayload(step, formData),
      },
      {
        saveConfiguration: (input) =>
          saveWizardConfiguration(input, { authorization: route.authorization }),
        saveProgress: async (input) =>
          fresh.data?.status !== 'draft'
            ? { ok: true as const, value: undefined }
            : saveTryoutSetupStep(input, { authorization: route.authorization }),
      },
    );
    if (result.kind === 'field_error')
      return {
        status: 'field_error',
        fieldErrors: result.fieldErrors,
        values: result.values,
      };
    if (result.kind === 'error')
      return {
        status: 'form_error',
        message:
          result.code === 'invalid_input'
            ? 'Review the fields and dropdown options, then try saving again.'
            : result.code === 'forbidden'
              ? 'You no longer have access to change this tryout.'
              : 'Could not save this step. Please try again.',
        values: result.values ?? submittedValues,
      };
    if (step === 'divisions' && formData.get('intent') === 'add-another') {
      redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/setup/divisions?saved=1&new=1`);
    }
    if (fresh.data.status !== 'draft') {
      const selected = String(
        formData.get(step === 'divisions' ? 'divisionId' : 'sessionId') ?? '',
      );
      redirect(
        `/app/${organizationSlug}/tryouts/${tryoutId}/setup/${step}?saved=1${selected ? `&selected=${encodeURIComponent(selected)}` : ''}`,
      );
    }
    await trackSupabaseWorkflowSafely(route.client, {
      name: 'workflow.completed',
      workflow: 'tryout_setup',
      organizationId: route.organization.id,
      correlationId: createCorrelationId(),
    });
    redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/setup/${result.nextStep}`);
  }
  return (
    <section className="workspace-stack">
      <PageHeader
        description={
          lifecycle.single
            ? 'Review every step before publishing. Single Tryout publication fixes the event identity, divisions and dates.'
            : 'Edit any setup step below. Saved changes keep the same tryout and registration link.'
        }
        eyebrow={tryout.name}
        title={tryout.status === 'draft' ? 'Guided setup' : 'Edit tryout setup'}
      />
      <WizardProgress
        completedSteps={progress?.completed_steps ?? []}
        currentStep={step}
        hrefBase={`/app/${organizationSlug}/tryouts/${tryoutId}/setup`}
      />
      <TryoutWizard
        key={`${step}-${tryout.version}-${saved}-${rawNew === '1'}-${selectedId ?? ''}`}
        action={save}
        status={tryout.status}
        singleTryout={lifecycle.single}
        overviewHref={`/app/${organizationSlug}/tryouts/${tryoutId}/overview`}
        configuration={configuration.data}
        selectedId={selectedId}
        addNewDivision={rawNew === '1'}
        basics={basics}
        blockers={blockers}
        divisions={divisions ?? []}
        error={error}
        name={tryout.name}
        sessions={sessions ?? []}
        step={step}
        saved={saved}
        registrationForm={registrationForm}
      />
    </section>
  );
}
