import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import '../../stubs/navigation-browser';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectedEvent } from '../../../src/modules/organizations/components/selected-event';
import { eventNavigationOptions } from '../../../src/modules/organizations/application/event-navigation-options';
import { EventNavigation } from '../../../src/modules/talent/ui/event-navigation';
import { EventActionSummary } from '../../../src/modules/talent/ui/event-action-summary';
import {
  buildAppNavigation,
  flattenNavigation,
} from '../../../src/modules/organizations/components/app-navigation-model';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import type { OrganizationId, UserId } from '../../../src/lib/ids';

let pathname = '/app/club/home';
let query = '';
const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push }),
}));
const auth: AuthorizationContext = {
  userId: 'user' as UserId,
  organizationId: 'org' as OrganizationId,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [],
};
const events = [
  { id: 'one', name: 'Basketball U14', href: '/app/club/tryouts/one/overview' },
  { id: 'two', name: 'Basketball U16', href: '/app/club/tryouts/two/overview' },
];
afterEach(() => {
  query = '';
  localStorage.clear();
  vi.restoreAllMocks();
  pathname = '/app/club/home';
  push.mockClear();
});

describe('four-stage event workflow and persistence', () => {
  it('offers exactly four ordered stages and includes nested setup, sessions and compare', () => {
    pathname = '/app/club/tryouts/one/setup/rubrics';
    render(
      <EventNavigation
        base="/app/club/tryouts/one"
        links={[
          ['registration', 'Registration'],
          ['overview', 'Event dashboard'],
          ['setup/basics', 'Event setup'],
          ['sessions', 'Sessions'],
          ['live', 'Event-day dashboard'],
          ['rankings', 'Rankings'],
          ['compare', 'Compare athletes'],
          ['reports', 'Reports'],
        ]}
      />,
    );
    const stageNav = screen.getByRole('navigation', { name: 'Tryout workflow' });
    expect(
      within(stageNav)
        .getAllByRole('link')
        .map((e) => e.textContent),
    ).toEqual(['Setup', 'Run Tryout', 'Review Results', 'Share Results']);
    expect(within(stageNav).getByRole('link', { name: 'Setup' })).toHaveAttribute(
      'href',
      '/app/club/tryouts/one/overview',
    );
    expect(screen.getByRole('link', { name: 'Event setup' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Sessions' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Tryout section'), { target: { value: 'compare' } });
    expect(push).toHaveBeenCalledWith('/app/club/tryouts/one/compare');
    fireEvent.change(screen.getByLabelText('Tryout section'), { target: { value: 'arbitrary' } });
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('hides unavailable stages and never manufactures unauthorized destinations', () => {
    pathname = '/app/club/tryouts/one/check-in';
    render(<EventNavigation base="/app/club/tryouts/one" links={[['check-in', 'Check-in']]} />);
    expect(
      within(screen.getByRole('navigation', { name: 'Tryout workflow' })).getAllByRole('link'),
    ).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Setup' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Check-in' })).toHaveAttribute('aria-current', 'page');
  });
  it('retains an allowed selection without navigating and ignores stale unauthorized storage', async () => {
    localStorage.setItem('owner.org', 'forbidden');
    const view = render(<SelectedEvent events={events} storageKey="owner.org" />);
    expect(screen.queryByRole('link', { name: /Open Basketball/ })).toBeNull();
    expect(screen.getByLabelText('Tryout shortcut')).not.toBeVisible();
    await userEvent.click(screen.getByText('Tryout shortcut', { selector: 'summary' }));
    await userEvent.selectOptions(screen.getByRole('combobox'), 'two');
    expect(localStorage.getItem('owner.org')).toBe('two');
    expect(screen.getByRole('link', { name: 'Open Basketball U16' })).toHaveAttribute(
      'href',
      events[1]!.href,
    );
    expect(push).not.toHaveBeenCalled();
    view.unmount();
    render(<SelectedEvent events={events} storageKey="owner.org" />);
    await userEvent.click(screen.getByText('Tryout shortcut', { selector: 'summary' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('two'));
  });
  it('follows direct navigation/back and isolates organization/account preferences', async () => {
    localStorage.setItem('other.org', 'two');
    pathname = '/app/club/tryouts/one/sessions';
    const view = render(<SelectedEvent events={events} storageKey="user.org" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(localStorage.getItem('user.org')).toBe('one');
    pathname = '/app/club/tryouts/two/live';
    view.rerender(<SelectedEvent events={events} storageKey="user.org" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    pathname = '/app/club/home';
    view.rerender(<SelectedEvent events={[events[0]!]} storageKey="new-user.org" />);
    await userEvent.click(screen.getByText('Tryout shortcut', { selector: 'summary' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''));
    expect(screen.queryByRole('link', { name: 'Open Basketball U16' })).toBeNull();
  });
  it('binds evaluator query selection only to allowed options and clears invalid or repeated scope', async () => {
    pathname = '/app/club/evaluate';
    query = 'tryout=two';
    const view = render(<SelectedEvent events={events} storageKey="user.org" />);
    expect(screen.getByLabelText('Tryout shortcut')).toBeVisible();
    expect(screen.getByRole('combobox')).toHaveValue('two');
    query = 'tryout=one';
    view.rerender(<SelectedEvent events={events} storageKey="user.org" />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('one'));
    query = 'tryout=forbidden';
    view.rerender(<SelectedEvent events={events} storageKey="user.org" />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(''));
    query = 'tryout=one&tryout=two';
    view.rerender(<SelectedEvent events={events} storageKey="user.org" />);
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.queryByRole('link', { name: /Open Basketball/ })).toBeNull();
  });
  it('does not imply a saved event is the current scoring-session context', () => {
    localStorage.setItem('user.org', 'two');
    pathname = '/app/club/evaluate/session/assigned-session/athlete/player';
    render(<SelectedEvent events={events} storageKey="user.org" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('link', { name: /Open Basketball/ })).toBeNull();
  });
  it('remains usable with unavailable storage and repeated keyboard selections', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('blocked');
    });
    render(<SelectedEvent events={events} storageKey="blocked" />);
    await userEvent.click(screen.getByText('Tryout shortcut', { selector: 'summary' }));
    const select = screen.getByRole('combobox');
    select.focus();
    await userEvent.selectOptions(select, 'one');
    await userEvent.selectOptions(select, 'one');
    expect(screen.getAllByRole('link', { name: 'Open Basketball U14' })).toHaveLength(1);
    expect(select).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('role and snapshot boundaries', () => {
  it('limits event metadata to assignments, respects narrow scopes and finalized reviewer access', () => {
    expect(eventNavigationOptions(auth, 'club', events)).toEqual([]);
    const reviewer = {
      ...auth,
      assignments: [
        { role: 'reviewer' as const, scope: { kind: 'tryout' as const, tryoutId: 'one' } },
      ],
    };
    expect(eventNavigationOptions(reviewer, 'club', events)).toEqual([
      { id: 'one', name: 'Basketball U14', href: '/app/club/tryouts/one/reports' },
    ]);
    const scoped = {
      ...auth,
      assignments: [
        {
          role: 'director' as const,
          scope: { kind: 'session' as const, tryoutId: 'one', sessionId: 'session' },
        },
      ],
    };
    expect(eventNavigationOptions(scoped, 'club', events)).toEqual([]);
    expect(
      flattenNavigation(
        buildAppNavigation({ authorization: scoped, organizationSlug: 'club' }),
      ).map(({ href }) => href),
    ).toEqual(
      ['live', 'staff', 'rankings', 'rosters', 'reports'].map(
        (segment) => `/app/club/tryouts/one/${segment}`,
      ),
    );
    const sessionReviewer = {
      ...scoped,
      assignments: scoped.assignments.map((assignment) => ({
        ...assignment,
        role: 'reviewer' as const,
      })),
    };
    expect(eventNavigationOptions(sessionReviewer, 'club', events)).toEqual([]);
    expect(
      flattenNavigation(
        buildAppNavigation({ authorization: sessionReviewer, organizationSlug: 'club' }),
      ).map(({ href }) => href),
    ).toEqual(['/app/club/tryouts/one/rosters', '/app/club/tryouts/one/reports']);

    const groups = buildAppNavigation({
      authorization: reviewer,
      organizationSlug: 'club',
      tryoutNames: { one: 'Basketball U14' },
    });
    expect(flattenNavigation(groups).map(({ label }) => label)).toEqual([
      'Rosters · Basketball U14',
      'Share Results · Basketball U14',
    ]);
    expect(flattenNavigation(groups).some(({ href }) => href.endsWith('/rankings'))).toBe(false);
    expect(
      eventNavigationOptions(
        { ...reviewer, membershipStatus: 'inactive' as 'active' },
        'club',
        events,
      ),
    ).toEqual([]);
  });
  it('exposes manager events and keeps evaluator navigation in the assigned workspace', () => {
    expect(
      eventNavigationOptions({ ...auth, organizationRole: 'owner' }, 'club', events),
    ).toHaveLength(2);
    const evaluator = {
      ...auth,
      assignments: [
        {
          role: 'evaluator' as const,
          scope: {
            kind: 'group' as const,
            tryoutId: 'one',
            groupId: 'group',
            sessionId: 'session',
          },
        },
      ],
    };
    expect(eventNavigationOptions(evaluator, 'club', events)).toEqual([
      { id: 'one', name: 'Basketball U14', href: '/app/club/evaluate?tryout=one' },
    ]);
    expect(
      flattenNavigation(
        buildAppNavigation({ authorization: evaluator, organizationSlug: 'club' }),
      ).map(({ href }) => href),
    ).toEqual(['/app/club/evaluate']);
  });
  it('keeps outstanding observations distinct from scores, skipping, absence and sync history', () => {
    render(
      <EventActionSummary
        base="/app/club/tryouts/one"
        dashboard={{
          registrations: 10,
          checkedIn: 7,
          activeEvaluators: 3,
          completedEvaluations: 4,
          expectedEvaluations: 12,
          recordedSyncExceptions: 9,
          generatedAt: '2026-10-18T00:00:00Z',
        }}
      />,
    );
    expect(screen.getByText('8 expected scorecards not complete')).toBeVisible();
    expect(
      screen.getByText(/separate from zero scores, skipped observations and absences/),
    ).toBeVisible();
    expect(screen.queryByText(/9 unresolved/)).toBeNull();
    expect(screen.getByRole('link', { name: /Review observation coverage/ })).toHaveAttribute(
      'href',
      '/app/club/tryouts/one/coverage',
    );
  });
});

describe('responsive navigation CSS boundary contract (source only)', () => {
  it.each([900, 1000, 1099.5])(
    'retains dock and focus clearance throughout mobile width %s',
    (width) => {
      const css = postcss.parse(readFileSync('src/components/layout/product-workflow.css', 'utf8'));
      const mobile = css.nodes.find(
        (node) =>
          node.type === 'atrule' && node.name === 'media' && node.params === '(width < 1100px)',
      );
      expect(mobile?.type).toBe('atrule');
      if (!mobile || mobile.type !== 'atrule') throw Error('Missing shared mobile interval');
      const threshold = Number(mobile.params.match(/width < (\d+)px/)?.[1]);
      expect(width < threshold).toBe(true);
      expect(1100 < threshold).toBe(false);
      const block = mobile.toString();
      expect(block).toContain('--mobile-navigation-height:');
      expect(block).toMatch(/\.app-frame-workspace \.mobile-navigation\s*\{\s*display: block/);
      expect(block).toMatch(
        /\.app-frame-workspace \.evaluation-save-dock\s*\{\s*bottom: var\(--mobile-navigation-height\)/,
      );
      expect(block).toContain('scroll-margin-bottom: calc(var(--mobile-navigation-height) + 6rem)');
      expect(block).toContain(
        'scroll-padding-bottom: calc(10rem + env(safe-area-inset-bottom, 0px))',
      );
    },
  );
});

describe('compact actions retain full scoped identity', () => {
  const names = [
    'A'.repeat(160),
    'National Development Selection Camp Under Fifteen Final Assessment',
  ];
  const contracts = [
    {
      role: 'director' as const,
      actions: ['Run Tryout', 'Staff', 'Review Results', 'Rosters', 'Share Results'],
      segments: ['live', 'staff', 'rankings', 'rosters', 'reports'],
    },
    {
      role: 'reviewer' as const,
      actions: ['Rosters', 'Share Results'],
      segments: ['rosters', 'reports'],
    },
    { role: 'checkin' as const, actions: ['Check-in'], segments: ['check-in'] },
  ];
  it.each(names.flatMap((name) => contracts.map((contract) => ({ name, ...contract }))))(
    '$role session assignment preserves routes and full labels for $name',
    ({ name, role, actions, segments }) => {
      const authorization: AuthorizationContext = {
        ...auth,
        assignments: [
          { role, scope: { kind: 'session', tryoutId: 'one', sessionId: 'assigned-session' } },
        ],
      };
      const plain = flattenNavigation(
        buildAppNavigation({ authorization, organizationSlug: 'club' }),
      );
      const named = flattenNavigation(
        buildAppNavigation({
          authorization,
          organizationSlug: 'club',
          tryoutNames: { one: name, forbidden: 'Unauthorized tryout' },
        }),
      );
      expect(named.map((item) => item.href)).toEqual(
        segments.map((segment) => `/app/club/tryouts/one/${segment}`),
      );
      expect(named.map((item) => item.href)).toEqual(plain.map((item) => item.href));
      expect(named.map((item) => item.compactLabel)).toEqual(actions);
      expect(named.map((item) => item.label)).toEqual(
        actions.map((action) => `${action} · ${name}`),
      );
      expect(named.map((item) => item.accessibleLabel)).toEqual(
        actions.map((action) => `${action} for ${name}`),
      );
      expect(named.some((item) => /organization|forbidden|evaluate/.test(item.href))).toBe(false);
      if (role !== 'director')
        expect(named.some((item) => /\/(staff|rankings|live)$/.test(item.href))).toBe(false);
    },
  );
  it('keeps evaluator-only assignments outside scoped director and organization routes', () => {
    const authorization: AuthorizationContext = {
      ...auth,
      assignments: [
        { role: 'evaluator', scope: { kind: 'session', tryoutId: 'one', sessionId: 'session' } },
      ],
    };
    expect(
      flattenNavigation(
        buildAppNavigation({
          authorization,
          organizationSlug: 'club',
          tryoutNames: { one: names[0]! },
        }),
      ),
    ).toEqual([{ href: '/app/club/evaluate', label: 'My scoring', icon: 'evaluate' }]);
  });
});
