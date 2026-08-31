export type OnboardingFacts = Readonly<{
  organizationExists: boolean;
  settingsConfigured: boolean;
  registrationConfigured: boolean;
  activeStaffCount: number;
  publishedRubricCount: number;
  sessionCount: number;
  completedEvaluationCount: number;
  finalizedRosterCount: number;
}>;

export type OnboardingMilestoneKey =
  | 'organization'
  | 'settings'
  | 'registration'
  | 'staff'
  | 'rubric'
  | 'session'
  | 'evaluation'
  | 'finalRoster';

export type OnboardingProgress = Readonly<{
  items: readonly Readonly<{
    key: OnboardingMilestoneKey;
    label: string;
    complete: boolean;
  }>[];
  completedCount: number;
  totalCount: number;
  percent: number;
  next: Readonly<{ key: OnboardingMilestoneKey; label: string; complete: boolean }> | null;
}>;

export function deriveOnboardingProgress(facts: OnboardingFacts): OnboardingProgress {
  const items = [
    { key: 'organization', label: 'Create your organization', complete: facts.organizationExists },
    {
      key: 'settings',
      label: 'Confirm settings and terminology',
      complete: facts.settingsConfigured,
    },
    {
      key: 'registration',
      label: 'Configure registration',
      complete: facts.registrationConfigured,
    },
    { key: 'staff', label: 'Assign staff', complete: facts.activeStaffCount > 0 },
    { key: 'rubric', label: 'Publish a scoring rubric', complete: facts.publishedRubricCount > 0 },
    { key: 'session', label: 'Schedule a session', complete: facts.sessionCount > 0 },
    {
      key: 'evaluation',
      label: 'Complete an evaluation',
      complete: facts.completedEvaluationCount > 0,
    },
    { key: 'finalRoster', label: 'Finalize a roster', complete: facts.finalizedRosterCount > 0 },
  ] as const satisfies readonly { key: OnboardingMilestoneKey; label: string; complete: boolean }[];
  const completedCount = items.filter((item) => item.complete).length;
  return {
    items,
    completedCount,
    totalCount: items.length,
    percent: Math.round((completedCount / items.length) * 100),
    next: items.find((item) => !item.complete) ?? null,
  };
}
