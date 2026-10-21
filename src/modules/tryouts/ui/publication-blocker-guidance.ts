import type { TryoutSetupStep } from '../application/save-tryout-setup-step';

const guidance: Record<string, { label: string; step?: TryoutSetupStep }> = {
  division_missing: { label: 'Add at least one age or level division.', step: 'divisions' },
  session_missing: { label: 'Add at least one tryout session.', step: 'sessions' },
  registration_form_missing: {
    label: 'Create the athlete registration form.',
    step: 'registration',
  },
  rubric_invalid: {
    label: 'Choose published scoring criteria for every session; category weights must total 100%.',
    step: 'rubrics',
  },
  registration_closed: { label: 'Set a future registration closing time.', step: 'basics' },
  single_tryout_schedule_invalid: {
    label: 'Keep Single Tryout sessions within 14 days and close registration by the last session.',
    step: 'sessions',
  },
  subscription_required: { label: 'An active eligible subscription is required to publish.' },
};

export function publicationBlockerGuidance(code: string): {
  label: string;
  step?: TryoutSetupStep;
} {
  return guidance[code] ?? { label: `Review setup: ${code.replaceAll('_', ' ')}.` };
}
