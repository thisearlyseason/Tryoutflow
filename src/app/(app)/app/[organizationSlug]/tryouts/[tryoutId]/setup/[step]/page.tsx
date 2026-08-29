import { notFound, redirect } from 'next/navigation';

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
import { TryoutWizard } from '@/modules/tryouts/ui/tryout-wizard';
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
  const { data: tryout } = await current.client
    .from('tryouts')
    .select('id, name, status, version')
    .eq('organization_id', current.organization.id)
    .eq('id', tryoutId)
    .maybeSingle();
  if (!tryout || tryout.status !== 'draft') notFound();
  const { data: progress } = await current.client
    .from('tryout_setup_progress')
    .select('completed_steps')
    .eq('organization_id', current.organization.id)
    .eq('tryout_id', tryoutId)
    .maybeSingle();
  const validation = await validateTryoutForPublish(
    { organizationId: current.organization.id, tryoutId },
    { authorization: current.authorization },
  );
  const blockers = validation.ok ? validation.value.blockers : ['authorization_required'];
  const { data: divisions } = await current.client
    .from('tryout_divisions')
    .select('id, name')
    .eq('organization_id', current.organization.id)
    .eq('tryout_id', tryoutId)
    .order('sort_order');
  const { data: sessions } = await current.client
    .from('tryout_sessions')
    .select('id, name')
    .eq('organization_id', current.organization.id)
    .eq('tryout_id', tryoutId)
    .order('sort_order');
  async function save(formData: FormData) {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const fresh = await route.client
      .from('tryouts')
      .select('id, name, version, status')
      .eq('organization_id', route.organization.id)
      .eq('id', tryoutId)
      .maybeSingle();
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
    if (result.kind === 'error')
      redirect(
        `/app/${organizationSlug}/tryouts/${tryoutId}/setup/${step}?error=${encodeURIComponent(result.code)}`,
      );
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
