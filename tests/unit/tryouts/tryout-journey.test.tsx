import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  TryoutJourney,
  TryoutJourneyNavigation,
} from '../../../src/modules/tryouts/ui/tryout-journey';
import type { TryoutJourney as Journey } from '../../../src/modules/tryouts/application/load-tryout-journey';

const baseHref = '/app/badlands/tryouts/22222222-2222-4222-8222-222222222222';
const journey: Journey = {
  tryout: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Fall Evaluations',
    slug: 'fall-evaluations',
    status: 'published',
  },
  nextStage: 'run',
  primaryAction: { label: 'Open check-in', href: `${baseHref}/check-in` },
  stages: [
    {
      id: 'prepare',
      title: 'Prepare',
      purpose: 'Configure and publish the tryout.',
      status: 'complete',
      supportingText: 'Tryout published',
      primaryAction: { label: 'Review setup', href: `${baseHref}/setup/review` },
      secondaryActions: [],
    },
    {
      id: 'participants',
      title: 'Participants',
      purpose: 'Bring athletes into the tryout.',
      status: 'ready',
      supportingText: '8 participants registered',
      primaryAction: { label: 'Manage participants', href: `${baseHref}/registration` },
      secondaryActions: [{ label: 'Share registration link', href: '#registration-share' }],
    },
    {
      id: 'run',
      title: 'Run tryout',
      purpose: 'Check in athletes and collect evaluations.',
      status: 'ready',
      supportingText: '2 sessions · 0 check-ins · 0 completed evaluations',
      primaryAction: { label: 'Open check-in', href: `${baseHref}/check-in` },
      secondaryActions: [{ label: 'Review sessions', href: `${baseHref}/sessions` }],
    },
    {
      id: 'decide',
      title: 'Make decisions',
      purpose: 'Review evidence and build rosters.',
      status: 'not-started',
      supportingText: 'No completed evaluations yet',
      primaryAction: { label: 'Review rankings', href: `${baseHref}/rankings` },
      secondaryActions: [{ label: 'Build rosters', href: `${baseHref}/rosters` }],
      blocker: 'Complete at least one evaluation before making decisions.',
    },
    {
      id: 'complete',
      title: 'Complete',
      purpose: 'Communicate and report from immutable roster evidence.',
      status: 'not-started',
      supportingText: 'No finalized roster yet',
      primaryAction: { label: 'Build rosters', href: `${baseHref}/rosters` },
      secondaryActions: [{ label: 'Review reports', href: `${baseHref}/reports` }],
      blocker: 'Finalize a roster before communicating decisions.',
    },
  ],
};

describe('tryout journey UI', () => {
  it('renders one exact recommendation and five truthful stages with specialist links', () => {
    render(<TryoutJourney journey={journey} />);

    const recommendation = screen.getByRole('region', { name: 'Recommended next action' });
    expect(within(recommendation).getByRole('heading')).toHaveTextContent('Run tryout');
    expect(within(recommendation).getByRole('link', { name: 'Open check-in' })).toHaveAttribute(
      'href',
      `${baseHref}/check-in`,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Participants' })).toBeVisible();
    expect(screen.getByText('8 participants registered')).toBeVisible();
    expect(screen.getAllByText('Not started')).toHaveLength(2);
    expect(
      screen.getByText('Complete at least one evaluation before making decisions.'),
    ).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Build rosters' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Build rosters' })[0]).toHaveAttribute(
      'href',
      `${baseHref}/rosters`,
    );
  });

  it('keeps compact overview and stage-next navigation available beside specialist controls', () => {
    render(
      <TryoutJourneyNavigation
        nextAction={{ label: 'Review rankings', href: `${baseHref}/rankings` }}
        overviewHref={`${baseHref}/overview`}
      />,
    );

    const navigation = screen.getByRole('navigation', { name: 'Tryout journey' });
    expect(within(navigation).getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
      'href',
      `${baseHref}/overview`,
    );
    expect(within(navigation).getByRole('link', { name: 'Next: Review rankings' })).toHaveAttribute(
      'href',
      `${baseHref}/rankings`,
    );
  });
});
