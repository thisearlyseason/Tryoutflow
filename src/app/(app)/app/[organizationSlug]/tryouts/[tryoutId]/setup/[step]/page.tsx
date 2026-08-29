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
import { TryoutWizard } from '@/modules/tryouts/ui/tryout-wizard';
import { WizardProgress } from '@/modules/tryouts/ui/wizard-progress';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function TryoutSetupStepPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string; step: string }>;
}) {
  const { organizationSlug, step: rawStep, tryoutId } = await params;
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
    const result = await saveTryoutSetupStep(
      { organizationId: route.organization.id, tryoutId, step },
      { authorization: route.authorization },
    );
    const next =
      tryoutSetupSteps[Math.min(tryoutSetupSteps.indexOf(step) + 1, tryoutSetupSteps.length - 1)];
    redirect(
      `/app/${organizationSlug}/tryouts/${tryoutId}/setup/${next}${result.ok ? '' : `?error=${result.error.code}`}`,
    );
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
      <TryoutWizard action={save} blockers={blockers} name={tryout.name} step={step} />
    </section>
  );
}
