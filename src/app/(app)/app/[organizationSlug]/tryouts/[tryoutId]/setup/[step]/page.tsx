import { notFound, redirect } from 'next/navigation';

import { ErrorState } from '@/components/feedback/error-state';
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
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { organizationSlug, step: rawStep, tryoutId } = await params;
  const { error: rawError } = await searchParams;
  const error = typeof rawError === 'string' ? rawError : undefined;
  if (!tryoutSetupSteps.includes(rawStep as TryoutSetupStep)) notFound();
  const step = rawStep as TryoutSetupStep;
  const current = await requireCurrentOrganization(organizationSlug);
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
  if (!tryout || tryout.status !== 'draft') notFound();
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
  const [progressResult, validation, divisionsResult, sessionsResult] = await Promise.all([
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
    current.client
      .from('tryout_divisions')
      .select('id, name')
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', tryoutId)
      .order('sort_order'),
    current.client
      .from('tryout_sessions')
      .select('id, name')
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', tryoutId)
      .order('sort_order'),
  ]);
  const loadError = progressResult.error ?? divisionsResult.error ?? sessionsResult.error;
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
  const divisions = divisionsResult.data;
  const sessions = sessionsResult.data;
  const blockers = validation.value.blockers;
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
    if (!fresh.data || fresh.data.status !== 'draft') notFound();
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
        saveProgress: (input) => saveTryoutSetupStep(input, { authorization: route.authorization }),
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
        message: 'Could not save this step',
        values: result.values ?? submittedValues,
      };
    await trackSupabaseWorkflowSafely(route.client, {
      name: 'workflow.completed',
      workflow: 'tryout_setup',
      organizationId: route.organization.id,
      correlationId: createCorrelationId(),
    });
    redirect(`/app/${organizationSlug}/tryouts/${tryoutId}/setup/${result.nextStep}`);
  }
  return (
    <section>
      <p className="eyebrow">{tryout.name}</p>
      <h2>Guided setup</h2>
      <WizardProgress
        completedSteps={progress?.completed_steps ?? []}
        currentStep={step}
        hrefBase={`/app/${organizationSlug}/tryouts/${tryoutId}/setup`}
      />
      <TryoutWizard
        action={save}
        basics={basics}
        blockers={blockers}
        divisions={divisions ?? []}
        error={error}
        name={tryout.name}
        sessions={sessions ?? []}
        step={step}
      />
    </section>
  );
}
