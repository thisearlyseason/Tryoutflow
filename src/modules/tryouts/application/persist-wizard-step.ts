import type { AppResult } from '../../../lib/result';
import { tryoutSetupSteps, type TryoutSetupStep } from './save-tryout-setup-step';
import {
  boundedTryoutBasicsValues,
  validateTryoutBasics,
  type TryoutBasicsField,
  type TryoutBasicsInput,
} from './validate-tryout-basics';

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
): Promise<
  | { kind: 'advance'; nextStep: TryoutSetupStep }
  | {
      kind: 'field_error';
      fieldErrors: Partial<Record<TryoutBasicsField, string>>;
      values: TryoutBasicsInput;
    }
  | { kind: 'error'; code: string; values?: TryoutBasicsInput }
> {
  let validatedBasics: TryoutBasicsInput | undefined;
  if (input.step === 'basics') {
    const validation = validateTryoutBasics(input.payload);
    if (!validation.ok)
      return {
        kind: 'field_error',
        fieldErrors: validation.fieldErrors,
        values: boundedTryoutBasicsValues(input.payload),
      };
    validatedBasics = validation.value;
  }
  const persistenceInput = validatedBasics ? { ...input, payload: validatedBasics } : input;

  if (input.step !== 'review') {
    const configuration = await dependencies.saveConfiguration(persistenceInput);
    if (!configuration.ok)
      return { kind: 'error', code: configuration.error.code, values: validatedBasics };
  }

  const progress = await dependencies.saveProgress({
    organizationId: input.organizationId,
    tryoutId: input.tryoutId,
    step: input.step,
  });
  if (!progress.ok) return { kind: 'error', code: progress.error.code, values: validatedBasics };

  return {
    kind: 'advance',
    nextStep:
      tryoutSetupSteps[
        Math.min(tryoutSetupSteps.indexOf(input.step) + 1, tryoutSetupSteps.length - 1)
      ] ?? input.step,
  };
}
