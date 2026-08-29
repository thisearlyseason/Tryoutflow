import type { AppResult } from '../../../lib/result';
import { tryoutSetupSteps, type TryoutSetupStep } from './save-tryout-setup-step';

type SaveResult = AppResult<void, { code: string }>;

export type PersistWizardStepInput = {
  organizationId: string;
  tryoutId: string;
  step: TryoutSetupStep;
  payload: Record<string, unknown>;
};

export type PersistWizardStepDependencies = {
  saveConfiguration(input: PersistWizardStepInput): Promise<SaveResult>;
  saveProgress(input: Omit<PersistWizardStepInput, 'payload'>): Promise<SaveResult>;
};

export async function persistWizardStep(
  input: PersistWizardStepInput,
  dependencies: PersistWizardStepDependencies,
): Promise<{ kind: 'advance'; nextStep: TryoutSetupStep } | { kind: 'error'; code: string }> {
  if (input.step !== 'review') {
    const configuration = await dependencies.saveConfiguration(input);
    if (!configuration.ok) return { kind: 'error', code: configuration.error.code };
  }

  const progress = await dependencies.saveProgress({
    organizationId: input.organizationId,
    tryoutId: input.tryoutId,
    step: input.step,
  });
  if (!progress.ok) return { kind: 'error', code: progress.error.code };

  return {
    kind: 'advance',
    nextStep:
      tryoutSetupSteps[
        Math.min(tryoutSetupSteps.indexOf(input.step) + 1, tryoutSetupSteps.length - 1)
      ] ?? input.step,
  };
}
