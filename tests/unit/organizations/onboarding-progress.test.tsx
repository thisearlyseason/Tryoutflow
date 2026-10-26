import { describe, expect, it } from 'vitest';

import {
  createOrganizationDashboardProjection,
  deriveOnboardingProgress,
} from '../../../src/modules/organizations/application/onboarding-progress';
import { OnboardingChecklist } from '../../../src/modules/organizations/components/onboarding-checklist';
import { OrganizationCommandCenter } from '../../../src/modules/organizations/components/organization-command-center';
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

  it('keeps exact durable facts beside derived progress for dashboard metrics', () => {
    const facts = {
      organizationExists: true,
      settingsConfigured: true,
      registrationConfigured: true,
      activeStaffCount: 12,
      publishedRubricCount: 2,
      sessionCount: 4,
      completedEvaluationCount: 83,
      finalizedRosterCount: 1,
    } as const;
    const projection = createOrganizationDashboardProjection(facts);

    expect(projection.facts).toEqual(facts);
    expect(projection.progress.completedCount).toBe(8);
    render(<OrganizationCommandCenter projection={projection} />);
    expect(screen.getByText('12')).toBeVisible();
    expect(screen.getByText('83')).toBeVisible();
    expect(screen.getByText('Finalized rosters')).toBeVisible();
  });
});
