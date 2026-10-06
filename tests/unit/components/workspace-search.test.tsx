import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppTopbar } from '../../../src/components/layout/app-topbar';

describe('workspace page search', () => {
  it.each([
    ['Evaluator', 'evaluators'],
    ['Owner', 'coaches'],
    ['Administrator', 'coaches'],
    ['Director', 'coaches'],
    ['Check-in', 'checkin'],
    ['Reviewer', 'reviewers'],
    ['Evaluator · Reviewer', 'evaluators'],
  ])('opens the correct guide for %s', (roleLabel, audience) => {
    render(
      <AppTopbar organization={{ name: 'Club', slug: 'club' }} roleLabel={roleLabel} groups={[]} />,
    );
    expect(screen.getByRole('link', { name: 'How to use TryoutFlow' })).toHaveAttribute(
      'href',
      `/how-to?audience=${audience}`,
    );
  });

  it('opens the scouting workflow for a scouting-only member', () => {
    render(
      <AppTopbar
        organization={{ name: 'Club', slug: 'club' }}
        roleLabel="Member"
        groups={[
          {
            id: 'workspace',
            label: 'My workspace',
            items: [{ label: 'Scouting', href: '/app/club/scouting', icon: 'evaluate' }],
          },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'How to use TryoutFlow' })).toHaveAttribute(
      'href',
      '/how-to?audience=scouting',
    );
  });
  it('searches only supplied role navigation and clears results on Escape', () => {
    render(
      <AppTopbar
        organization={{ name: 'Club', slug: 'club' }}
        roleLabel="Evaluator"
        groups={[
          {
            id: 'workspace',
            label: 'My workspace',
            items: [{ label: 'Evaluate', href: '/app/club/evaluate', icon: 'evaluate' }],
          },
        ]}
      />,
    );
    const search = screen.getByRole('textbox', { name: 'Find athletes, tryouts or pages' });
    fireEvent.change(search, { target: { value: 'eval' } });
    expect(
      screen.getByRole('link', { name: /Search athletes, tryouts and evaluators/ }),
    ).toHaveAttribute('href', '/app/club/search?q=eval');
    expect(screen.getByRole('link', { name: /Evaluate/ })).toHaveAttribute(
      'href',
      '/app/club/evaluate',
    );
    fireEvent.change(search, { target: { value: 'Billing' } });
    expect(screen.getByText('No pages found. Try another name.')).toBeVisible();
    expect(screen.queryByRole('link', { name: /Billing/ })).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(
      screen.queryByRole('navigation', { name: 'Workspace search results' }),
    ).not.toBeInTheDocument();
  });
});

import { OrganizationCommandCenter } from '../../../src/modules/organizations/components/organization-command-center';
import { createOrganizationDashboardProjection } from '../../../src/modules/organizations/application/onboarding-progress';

it('does not expose new management shortcuts to a direct home-page visitor without management access', () => {
  render(
    <OrganizationCommandCenter
      organizationSlug="club"
      projection={createOrganizationDashboardProjection({
        organizationExists: true,
        settingsConfigured: true,
        registrationConfigured: true,
        activeStaffCount: 1,
        publishedRubricCount: 1,
        sessionCount: 1,
        completedEvaluationCount: 1,
        finalizedRosterCount: 1,
      })}
    />,
  );
  expect(screen.queryByRole('link', { name: 'Create Tryout' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Quick actions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Recent tryouts' })).not.toBeInTheDocument();
});
