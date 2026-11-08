import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrganizationCommandCenter } from '@/modules/organizations/components/organization-command-center';
import { createOrganizationDashboardProjection } from '@/modules/organizations/application/onboarding-progress';
import type { TryoutJourney } from '@/modules/tryouts/application/load-tryout-journey';

const projection = createOrganizationDashboardProjection({
  organizationExists: true,
  settingsConfigured: true,
  registrationConfigured: true,
  activeStaffCount: 8,
  publishedRubricCount: 3,
  sessionCount: 10,
  completedEvaluationCount: 99,
  finalizedRosterCount: 4,
});
const base = '/app/club/tryouts/event';
const ids = ['prepare', 'participants', 'run', 'decide', 'complete'] as const;
const journey: TryoutJourney = {
  tryout: { id: 'event', name: 'New season tryout', slug: 'new-season', status: 'draft' },
  nextStage: 'prepare',
  primaryAction: { label: 'Continue setup', href: `${base}/setup/divisions` },
  stages: ids.map((id) => ({
    id,
    title: id === 'prepare' ? 'Prepare' : id,
    purpose: 'Next event task',
    status: 'not-started',
    supportingText: 'Nothing completed for this tryout',
    primaryAction: { label: 'Open task', href: base + '/overview' },
    secondaryActions: [],
  })) as unknown as TryoutJourney['stages'],
};
const props = {
  organizationSlug: 'club',
  organizationName: 'Example club',
  showManagementActions: true,
  projection,
};

describe('task-led workspace home', () => {
  it('leads with the current event action, independently of completed historical milestones', () => {
    render(
      <OrganizationCommandCenter
        {...props}
        recommendation={{ kind: 'journey', journey }}
        activity={{ tryouts: [], athletes: [] }}
      />,
    );
    const next = screen.getByRole('region', { name: 'Your next action' });
    expect(within(next).getByRole('heading', { name: 'New season tryout' })).toBeVisible();
    expect(within(next).getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      base + '/setup/divisions',
    );
    expect(within(next).queryByText('100%')).toBeNull();
    expect(screen.queryByText('Coach.')).toBeNull();
    expect(
      screen.getByRole('group', { name: 'Program totals and milestones' }),
    ).not.toHaveAttribute('open');
  });
  it('provides one obvious first task without a wall of historical zero counts', () => {
    render(
      <OrganizationCommandCenter
        {...props}
        recommendation={{ kind: 'first-tryout' }}
        activity={{ tryouts: [], athletes: [] }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Create your first tryout' })).toHaveAttribute(
      'href',
      '/app/club/tryouts/new',
    );
    expect(screen.getByText(/draft.*before.*publish/i)).toBeVisible();
    expect(screen.queryByRole('heading', { name: /quick actions/i })).toBeNull();
  });
  it('does not represent failed current-work loading as an empty organization', () => {
    render(
      <OrganizationCommandCenter
        {...props}
        recommendation={{ kind: 'unavailable' }}
        activity={{ tryouts: null, athletes: null }}
      />,
    );
    expect(screen.getByText(/current work could not be loaded/i)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Create your first tryout' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open tryouts' })).toHaveAttribute(
      'href',
      '/app/club/tryouts',
    );
  });
  it('retains completed program history under an explicitly scoped disclosure', () => {
    render(<OrganizationCommandCenter {...props} recommendation={{ kind: 'history' }} />);
    fireEvent.click(screen.getByText('Program totals and milestones'));
    expect(screen.getByText('99')).toBeVisible();
    expect(screen.getByText('Active staff assignments')).toBeVisible();
    expect(screen.getByText(/across all tryouts/i)).toBeVisible();
    expect(screen.queryByText('Season readiness')).toBeNull();
  });
  it('keeps staff tasks focused and hides organization milestones and management actions', () => {
    render(
      <OrganizationCommandCenter
        organizationSlug="club"
        organizationName="Example club"
        tasks={[
          {
            label: 'Evaluate athletes',
            href: '/app/club/evaluate',
            description: 'Your assigned sessions',
          },
        ]}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Your work' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Evaluate athletes/ })).toHaveAttribute(
      'href',
      '/app/club/evaluate',
    );
    expect(screen.queryByText('Program totals and milestones')).toBeNull();
    expect(screen.queryByRole('link', { name: /create.*tryout/i })).toBeNull();
  });
  it('explains an account with no assignments without suggesting unauthorized setup', () => {
    render(
      <OrganizationCommandCenter
        organizationSlug="club"
        organizationName="Example club"
        tasks={[]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No tasks assigned yet' })).toBeVisible();
    expect(screen.getByText(/ask your organizer/i)).toBeVisible();
    expect(screen.queryByRole('link', { name: /billing|create.*tryout|settings/i })).toBeNull();
  });
});

it('distinguishes unavailable staff access lookup from an account with no assignments', () => {
  render(<OrganizationCommandCenter organizationSlug="club" tasks={[]} tasksUnavailable />);
  expect(screen.getByText(/assigned work could not be loaded/i)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'No tasks assigned yet' })).toBeNull();
});
