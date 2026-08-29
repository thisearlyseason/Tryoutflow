import { notFound } from 'next/navigation';

import { tryoutSetupSteps, type TryoutSetupStep } from '../../../../../src/modules/tryouts/application/save-tryout-setup-step';
import { TryoutWizard } from '../../../../../src/modules/tryouts/ui/tryout-wizard';
import { WizardProgress } from '../../../../../src/modules/tryouts/ui/wizard-progress';

export default async function WizardFixture({ params }: { params: Promise<{ step: string }> }) {
  const { step: rawStep } = await params;
  if (!tryoutSetupSteps.includes(rawStep as TryoutSetupStep)) notFound();
  const step = rawStep as TryoutSetupStep;
  async function fixtureAction() { 'use server'; }
  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}><WizardProgress completedSteps={['basics', 'divisions']} currentStep={step} hrefBase="" /><TryoutWizard action={fixtureAction} blockers={step === 'review' ? ['rubric_invalid'] : []} divisions={[{ id: 'division-1', name: 'U15' }]} name="Fall ID Camp" sessions={[{ id: 'session-1', name: 'Skills' }]} step={step} /></main>;
}
