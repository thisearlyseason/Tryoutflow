import { describe, expect, it, vi } from 'vitest';

import { persistWizardStep } from '../../../src/modules/tryouts/application/persist-wizard-step';
import { failure, success } from '../../../src/lib/result';

const input = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  tryoutId: '22222222-2222-4222-8222-222222222222',
  step: 'basics' as const,
  payload: { name: 'Fall ID Camp' },
};

describe('persistWizardStep', () => {
  it('keeps the current step and does not record progress when configuration fails', async () => {
    const saveProgress = vi.fn();
    const result = await persistWizardStep(input, {
      saveConfiguration: vi.fn(async () => failure({ code: 'invalid_input' })),
      saveProgress,
    });

    expect(result).toEqual({ kind: 'error', code: 'invalid_input' });
    expect(saveProgress).not.toHaveBeenCalled();
  });

  it('keeps the current step when durable progress recording fails', async () => {
    const result = await persistWizardStep(input, {
      saveConfiguration: vi.fn(async () => success(undefined)),
      saveProgress: vi.fn(async () => failure({ code: 'unexpected' })),
    });

    expect(result).toEqual({ kind: 'error', code: 'unexpected' });
  });

  it('advances only after configuration and durable progress both succeed', async () => {
    const saveConfiguration = vi.fn(async () => success(undefined));
    const saveProgress = vi.fn(async () => success(undefined));
    const result = await persistWizardStep(input, { saveConfiguration, saveProgress });

    expect(result).toEqual({ kind: 'advance', nextStep: 'divisions' });
    expect(saveConfiguration).toHaveBeenCalledOnce();
    expect(saveProgress).toHaveBeenCalledOnce();
  });
});
