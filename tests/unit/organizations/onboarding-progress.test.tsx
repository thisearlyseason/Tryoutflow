import { describe, expect, it } from 'vitest';

import { deriveOnboardingProgress } from '../../../src/modules/organizations/application/onboarding-progress';
import { OnboardingChecklist } from '../../../src/modules/organizations/components/onboarding-checklist';
import { render, screen } from '@testing-library/react';

describe('authoritative onboarding progress', () => {
  it('derives every milestone from durable facts and reports the next incomplete step', () => {
    const progress = deriveOnboardingProgress({
      organizationExists: true,
      settingsConfigured: true,
      registrationConfigured: true,
      activeStaffCount: 2,
      publishedRubricCount: 1,
      sessionCount: 2,
      completedEvaluationCount: 3,
      finalizedRosterCount: 0,
    });

    expect(progress).toMatchObject({ completedCount: 7, totalCount: 8, percent: 88 });
    expect(progress.items.map(({ key, complete }) => [key, complete])).toEqual([
      ['organization', true],
      ['settings', true],
      ['registration', true],
      ['staff', true],
      ['rubric', true],
      ['session', true],
      ['evaluation', true],
      ['finalRoster', false],
    ]);
    expect(progress.next?.key).toBe('finalRoster');
  });

  it('does not accept caller completion booleans or infer later milestones from earlier ones', () => {
    const progress = deriveOnboardingProgress({
      organizationExists: true,
      settingsConfigured: false,
      registrationConfigured: false,
      activeStaffCount: 0,
      publishedRubricCount: 0,
      sessionCount: 0,
      completedEvaluationCount: 0,
      finalizedRosterCount: 0,
    });
    expect(progress.completedCount).toBe(1);
    expect(progress.items.slice(1).every((item) => !item.complete)).toBe(true);
  });

  it('renders durable progress accessibly without a client-storage dependency', () => {
    const progress = deriveOnboardingProgress({
      organizationExists: true,
      settingsConfigured: true,
      registrationConfigured: false,
      activeStaffCount: 0,
      publishedRubricCount: 0,
      sessionCount: 0,
      completedEvaluationCount: 0,
      finalizedRosterCount: 0,
    });
    render(<OnboardingChecklist progress={progress} />);
    expect(screen.getByRole('progressbar', { name: /onboarding progress/i })).toHaveAttribute(
      'aria-valuenow',
      '25',
    );
    expect(screen.getByText('Configure registration')).toBeInTheDocument();
    expect(screen.getAllByText(/complete/i).length).toBeGreaterThan(0);
  });
});
