import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AuditEventList,
  HealthMetrics,
  OrganizationDirectory,
  PlatformNavigation,
  SubscriptionDirectory,
  SupportElevationList,
} from '../../../src/modules/observability/ui/platform-administration';

describe('platform administration surfaces', () => {
  it('provides a labelled, keyboard-reachable platform navigation', () => {
    render(<PlatformNavigation />);
    const navigation = screen.getByRole('navigation', { name: 'Platform administration' });
    expect(within(navigation).getAllByRole('link')).toHaveLength(5);
    expect(within(navigation).getByRole('link', { name: 'System health' })).toHaveAttribute(
      'href',
      '/platform/health',
    );
  });

  it('uses responsive summary lists and an explicit empty state for organization metadata', () => {
    const { rerender } = render(<OrganizationDirectory organizations={[]} />);
    expect(screen.getByText('No organizations found.')).toBeVisible();

    rerender(
      <OrganizationDirectory
        organizations={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Badlands Hockey',
            slug: 'badlands-hockey',
            status: 'active',
            createdAt: '2026-08-31T18:00:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.getByRole('list', { name: 'Organizations' })).toHaveClass('md:grid-cols-2');
    expect(screen.getByText('Badlands Hockey')).toBeVisible();
  });

  it('renders only aggregate health and allow-listed subscription fields', () => {
    render(
      <>
        <HealthMetrics
          health={{
            database: 'ok',
            failedJobs: 2,
            webhookFailures: 1,
            communicationFailures: 1,
            integrationFailures: 0,
            synchronizationProblems: 3,
          }}
        />
        <SubscriptionDirectory
          subscriptions={[
            {
              organizationId: '11111111-1111-4111-8111-111111111111',
              organizationName: 'Badlands Hockey',
              organizationSlug: 'badlands-hockey',
              plan: 'club',
              state: 'active',
              currentPeriodEnd: '2026-09-30T00:00:00.000Z',
              cancelAtPeriodEnd: false,
              trialEnd: null,
              verifiedAt: '2026-08-31T18:00:00.000Z',
            },
          ]}
        />
      </>,
    );
    expect(screen.getByText('Failed jobs').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('club')).toBeVisible();
    expect(document.body.textContent).not.toContain('provider_customer');
  });

  it('renders audit and support evidence without generic metadata payloads', () => {
    render(
      <>
        <AuditEventList
          events={[
            {
              id: 'audit-1',
              organizationId: '11111111-1111-4111-8111-111111111111',
              organizationSlug: 'badlands-hockey',
              actorId: '22222222-2222-4222-8222-222222222222',
              action: 'platform.support_elevation.started',
              entityType: 'platform_support_elevation',
              entityId: '33333333-3333-4333-8333-333333333333',
              occurredAt: '2026-08-31T18:00:00.000Z',
            },
          ]}
        />
        <SupportElevationList
          elevations={[
            {
              id: '33333333-3333-4333-8333-333333333333',
              organizationId: '11111111-1111-4111-8111-111111111111',
              organizationSlug: 'badlands-hockey',
              supportUserId: '22222222-2222-4222-8222-222222222222',
              reason: 'Investigate support ticket T32-100',
              expiresAt: '2026-08-31T18:30:00.000Z',
              revokedAt: null,
              createdAt: '2026-08-31T18:00:00.000Z',
            },
          ]}
        />
      </>,
    );
    expect(screen.getByText('platform.support_elevation.started')).toBeVisible();
    expect(screen.getByText('Investigate support ticket T32-100')).toHaveClass('break-words');
    expect(document.body.textContent).not.toContain('private raw payload');
  });
});
