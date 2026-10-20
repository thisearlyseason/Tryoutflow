import type { TryoutSetupStep } from './save-tryout-setup-step';
import { wizardPayload } from './save-wizard-configuration';
import { boundedTryoutBasicsValues, type TryoutBasicsInput } from './validate-tryout-basics';

export async function prepareWizardSaveAttempt<T>(
  step: TryoutSetupStep,
  formData: FormData,
  loadFresh: () => PromiseLike<T>,
): Promise<{ fresh: T; submittedValues: TryoutBasicsInput | undefined }> {
  const submittedValues =
    step === 'basics' ? boundedTryoutBasicsValues(wizardPayload(step, formData)) : undefined;
  const fresh = await loadFresh();
  return { fresh, submittedValues };
}
