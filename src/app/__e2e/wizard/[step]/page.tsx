import { notFound } from 'next/navigation';

import {
  tryoutSetupSteps,
  type TryoutSetupStep,
} from '@/modules/tryouts/application/save-tryout-setup-step';
import { TryoutWizard } from '@/modules/tryouts/ui/tryout-wizard';
import { WizardProgress } from '@/modules/tryouts/ui/wizard-progress';

/** A deterministic visual harness only enabled by the Playwright web-server environment. */
export default async function TryoutWizardHarness({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  if (process.env.TRYOUTFLOW_E2E_HARNESS !== '1') notFound();
  const { step: rawStep } = await params;
  if (!tryoutSetupSteps.includes(rawStep as TryoutSetupStep)) notFound();
  const step = rawStep as TryoutSetupStep;
  async function recordProgress() {
    'use server';
  }
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1>Tryout wizard test harness</h1>
      <WizardProgress
        completedSteps={['basics', 'divisions']}
        currentStep={step}
        hrefBase="/wizard-test-harness"
      />
      <TryoutWizard
        action={recordProgress}
        blockers={step === 'review' ? ['rubric_invalid'] : []}
        name="Fall ID Camp"
        step={step}
      />
    </main>
  );
}
