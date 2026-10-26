import '../../stubs/navigation-browser';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MobileNav } from '../../../src/components/layout/mobile-nav';
import {
  buildAppNavigation,
  flattenNavigation,
} from '../../../src/modules/organizations/components/app-navigation-model';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { OrganizationId, UserId } from '../../../src/lib/ids';
import { workspaceReturnDestination } from '../../../src/components/layout/workspace-return-destination';
import { publicationBlockerGuidance } from '../../../src/modules/tryouts/ui/publication-blocker-guidance';

const auth: AuthorizationContext = {
  userId: 'fictional-user' as UserId,
  organizationId: 'fictional-org' as OrganizationId,
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
};
const events = [
  {
    id: 'fictional-event',
    name: 'Fictional tryout',
    href: '/app/qa/tryouts/fictional-event/overview',
  },
];

describe('task discovery without access expansion', () => {
  it('puts assigned scoring in mobile primary navigation while retaining all organizer destinations', () => {
    const baseline = buildAppNavigation({ authorization: auth, organizationSlug: 'qa' });
    const groups = buildAppNavigation({
      authorization: {
        ...auth,
        assignments: [
          { role: 'evaluator', scope: { kind: 'tryout', tryoutId: 'fictional-event' } },
        ],
      },
      organizationSlug: 'qa',
    });
    const destinations = flattenNavigation(groups).map(({ href }) => href);
    for (const item of flattenNavigation(baseline)) expect(destinations).toContain(item.href);
    render(
      <MobileNav
        groups={groups}
        organization={{ name: 'Fictional QA', slug: 'qa' }}
        roleLabel="Owner"
      />,
    );
    const navigation = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(navigation).getByRole('link', { name: 'My scoring' })).toHaveAttribute(
      'href',
      '/app/qa/evaluate',
    );
  });
  it('does not add scoring or organizer destinations to an unassigned member', () => {
    expect(
      buildAppNavigation({
        authorization: { ...auth, organizationRole: 'member' },
        organizationSlug: 'qa',
      }),
    ).toEqual([]);
    expect(
      flattenNavigation(buildAppNavigation({ authorization: auth, organizationSlug: 'qa' })).some(
        ({ href }) => href.endsWith('/evaluate'),
      ),
    ).toBe(false);
  });
  it('renders scouting tools for a permitted member without organizer or evaluator destinations', () => {
    const groups = buildAppNavigation({
      authorization: { ...auth, organizationRole: 'member' },
      organizationSlug: 'qa',
      hasScoutingAccess: true,
    });
    const hrefs = flattenNavigation(groups).map(({ href }) => href);
    expect(hrefs).toEqual(['/app/qa/scouting', '/app/qa/performance', '/app/qa/search']);
    render(
      <MobileNav
        groups={groups}
        organization={{ name: 'Fictional scouting', slug: 'qa' }}
        roleLabel="Member"
      />,
    );
    expect(screen.getByRole('link', { name: 'Scouting' })).toHaveAttribute(
      'href',
      '/app/qa/scouting',
    );
    expect(screen.queryByRole('link', { name: 'My scoring' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tryouts' })).toBeNull();
  });
  it('returns within the current verified tryout, or to an authorized scoring entry', () => {
    const groups = buildAppNavigation({ authorization: auth, organizationSlug: 'qa' });
    expect(
      workspaceReturnDestination('/app/qa/tryouts/fictional-event/staff', groups, events),
    ).toEqual({ href: events[0]!.href, label: 'Back to Fictional tryout' });
    expect(
      workspaceReturnDestination('/app/qa/tryouts/fictional-event/overview', groups, events)?.href,
    ).toBe('/app/qa/tryouts');
    expect(workspaceReturnDestination('/app/qa/tryouts/unknown/staff', [], [])).toBeNull();
    const evaluator = buildAppNavigation({
      authorization: {
        ...auth,
        organizationRole: 'member',
        assignments: [
          { role: 'evaluator', scope: { kind: 'tryout', tryoutId: 'fictional-event' } },
        ],
      },
      organizationSlug: 'qa',
    });
    expect(
      workspaceReturnDestination('/app/qa/evaluate/session/session/athletes/athlete', evaluator, [])
        ?.href,
    ).toBe('/app/qa/evaluate');
  });
  it('maps publication blockers to corrective steps without hiding unknown or entitlement blockers', () => {
    expect(publicationBlockerGuidance('rubric_invalid').step).toBe('rubrics');
    expect(publicationBlockerGuidance('rubric_invalid').label).toContain('100%');
    expect(publicationBlockerGuidance('subscription_required').step).toBeUndefined();
    expect(publicationBlockerGuidance('future_guard')).toEqual({
      label: 'Review setup: future guard.',
    });
  });
});
