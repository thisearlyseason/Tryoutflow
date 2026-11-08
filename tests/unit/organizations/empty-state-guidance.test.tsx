import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ current: vi.fn(), capture: vi.fn(), redirect: vi.fn() }));
vi.mock('@/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: mocks.current,
}));
vi.mock('@/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.capture,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw Error('NOT_FOUND');
  },
  redirect: (href: string) => {
    mocks.redirect(href);
    throw Error('REDIRECT');
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
import Athletes from '@/app/(app)/app/[organizationSlug]/athletes/page';
import Tryouts from '@/app/(app)/app/[organizationSlug]/tryouts/page';
import Sessions from '@/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/sessions/page';
const organizationId = '11111111-1111-4111-8111-111111111111';
const event = '22222222-2222-4222-8222-222222222222';
type Result = { data: unknown; error: unknown; count?: number | null };
function current(results: Record<string, Result>, staff = false, assigned = true) {
  const client = {
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from: (table: string) => {
      const result = results[table] ?? { data: [], error: null };
      const b = {
        select: () => b,
        eq: () => b,
        or: () => b,
        order: () => b,
        range: async () => result,
        maybeSingle: async () => result,
        then: (ok: (r: Result) => unknown) => Promise.resolve(result).then(ok),
      };
      return b;
    },
  };
  mocks.current.mockResolvedValue({
    userId: 'user',
    organization: { id: organizationId, slug: 'club', name: 'Club' },
    authorization: {
      userId: 'user',
      organizationId,
      organizationRole: staff ? 'member' : 'owner',
      membershipStatus: 'active',
      assignments:
        staff && assigned ? [{ role: 'director', scope: { kind: 'tryout', tryoutId: event } }] : [],
    },
    client,
  });
}
const params = Promise.resolve({ organizationSlug: 'club' });
const sessionParams = Promise.resolve({ organizationSlug: 'club', tryoutId: event });
beforeEach(() => vi.clearAllMocks());
it('distinguishes filtered no-matches from an empty directory and resets search to page1', async () => {
  current({ athletes: { data: [], error: null, count: 0 } });
  render(await Athletes({ params, searchParams: Promise.resolve({ q: 'Missing athlete' }) }));
  expect(screen.getByRole('heading', { name: 'No matching athletes' })).toBeVisible();
  expect(screen.queryByText(/No athletes yet/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Clear search' })).toHaveAttribute(
    'href',
    '/app/club/athletes',
  );
});
it('clears unsubmitted search edits when returning to the unfiltered directory', async () => {
  current({ athletes: { data: [], error: null, count: 0 } });
  const view = render(await Athletes({ params, searchParams: Promise.resolve({ q: 'Missing' }) }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search athletes' }), {
    target: { value: 'Unsubmitted replacement' },
  });
  view.rerender(await Athletes({ params, searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('searchbox', { name: 'Search athletes' })).toHaveValue('');
});
it.each([
  { data: [] },
  {
    data: [
      {
        id: 'a',
        given_name: 'Stale',
        family_name: 'Record',
        birth_date: null,
        created_at: '2026-11-01T00:00:00Z',
      },
    ],
  },
])('shows a retry, not empty/stale rows, on directory failure with data %j', async ({ data }) => {
  current({ athletes: { data, error: { code: 'offline' }, count: 0 } });
  render(await Athletes({ params, searchParams: Promise.resolve({ q: 'Jordan Lee', page: '2' }) }));
  expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/);
  expect(screen.queryByText(/No athletes yet/)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  const href = screen.getByRole('link', { name: 'Retry athletes' }).getAttribute('href')!;
  const url = new URL(href, 'https://example.test');
  expect(url.searchParams.get('q')).toBe('Jordan Lee');
  expect(url.searchParams.get('page')).toBe('2');
});
it('treats null directory data as unavailable rather than empty', async () => {
  current({ athletes: { data: null, error: null, count: null } });
  render(await Athletes({ params, searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'No athletes yet' })).toBeNull();
});
it('gives empty directory actions only to administrative viewers', async () => {
  current({ athletes: { data: [], error: null, count: 0 } });
  render(await Athletes({ params, searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('heading', { name: 'No athletes yet' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Import athletes' })).toHaveAttribute(
    'href',
    '/app/club/athletes/import',
  );
  cleanup();
  current({ athletes: { data: [], error: null, count: 0 } }, true);
  render(await Athletes({ params, searchParams: Promise.resolve({}) }));
  expect(screen.queryByRole('link', { name: /Import|Add prospect/ })).toBeNull();
  expect(screen.getByText(/Ask an owner or administrator/)).toBeVisible();
});
it('does not offer org-level creation to scoped directors in an empty tryout list', async () => {
  current({ tryouts: { data: [], error: null } }, true);
  render(await Tryouts({ params, searchParams: Promise.resolve({}) }));
  expect(screen.queryByRole('link', { name: 'Create tryout' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'No tryouts available' })).toBeVisible();
});
it('preserves list orientation and retry instead of an empty tryout claim on failure', async () => {
  current({ tryouts: { data: [], error: { code: 'offline' } } });
  render(await Tryouts({ params, searchParams: Promise.resolve({}) }));
  expect(screen.getByRole('heading', { level: 1, name: 'Tryouts' })).toBeVisible();
  expect(screen.queryByText('No tryouts yet')).toBeNull();
  expect(screen.getByRole('link', { name: 'Retry' })).toHaveAttribute('href', '/app/club/tryouts');
});
it('offers session setup for an editable draft with no check-in forward action', async () => {
  current({
    tryouts: { data: { id: event, name: 'Draft camp', status: 'draft' }, error: null },
    tryout_sessions: { data: [], error: null },
  });
  render(await Sessions({ params: sessionParams }));
  expect(screen.getByRole('link', { name: 'Add sessions' })).toHaveAttribute(
    'href',
    `/app/club/tryouts/${event}/setup/sessions`,
  );
  expect(screen.queryByRole('link', { name: 'Open check-in' })).toBeNull();
});
it('offers recovery navigation, not check-in or setup, on a session failure', async () => {
  current({
    tryouts: { data: { id: event, name: 'Camp', status: 'draft' }, error: null },
    tryout_sessions: { data: [], error: { code: 'offline' } },
  });
  render(await Sessions({ params: sessionParams }));
  expect(screen.getByRole('link', { name: 'Retry sessions' })).toHaveAttribute(
    'href',
    `/app/club/tryouts/${event}/sessions`,
  );
  expect(screen.getByRole('link', { name: 'Back to overview' })).toBeVisible();
  expect(screen.queryByRole('link', { name: /check-in|Add sessions/ })).toBeNull();
});
it('never offers setup for non-draft, missing or denied empty sessions', async () => {
  current({
    tryouts: { data: { id: event, name: 'Camp', status: 'finalized' }, error: null },
    tryout_sessions: { data: [], error: null },
  });
  render(await Sessions({ params: sessionParams }));
  expect(screen.queryByRole('link', { name: /setup|Add sessions/i })).toBeNull();
  expect(screen.getByText(/Ask an owner or event director/)).toBeVisible();
  cleanup();
  current({ tryouts: { data: null, error: null }, tryout_sessions: { data: [], error: null } });
  render(await Sessions({ params: sessionParams }));
  expect(screen.getByRole('link', { name: 'Back to tryouts' })).toBeVisible();
  expect(screen.queryByRole('link', { name: /setup|Add sessions/i })).toBeNull();
  cleanup();
  current({}, true, false);
  render(await Sessions({ params: sessionParams }));
  expect(screen.getByRole('heading', { name: 'Sessions unavailable' })).toBeVisible();
  expect(screen.queryByRole('link', { name: /setup|Add sessions/i })).toBeNull();
});
it('keeps populated session cards and check-in navigation', async () => {
  current({
    tryouts: { data: { id: event, name: 'Camp', status: 'published' }, error: null },
    tryout_sessions: {
      data: [
        {
          id: 's',
          name: 'Skills',
          starts_at: '2026-11-20T16:00:00Z',
          ends_at: '2026-11-20T17:00:00Z',
          location: 'Rink',
          capacity: 20,
          tryout_divisions: { name: 'U15' },
          session_groups: [],
        },
      ],
      error: null,
    },
  });
  render(await Sessions({ params: sessionParams }));
  expect(screen.getByRole('heading', { name: 'Skills' })).toBeVisible();
  expect(screen.getByRole('link', { name: /Open check-in/ })).toBeVisible();
});
it('does not describe a null sessions collection as empty', async () => {
  current({
    tryouts: { data: { id: event, name: 'Camp', status: 'draft' }, error: null },
    tryout_sessions: { data: null, error: null },
  });
  render(await Sessions({ params: sessionParams }));
  expect(screen.getByRole('heading', { name: 'Sessions temporarily unavailable' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Add sessions' })).toBeNull();
});
it('keeps populated athlete rows and their profile destinations', async () => {
  current({
    athletes: {
      data: [
        {
          id: 'athlete1',
          given_name: 'Jordan',
          family_name: 'Lee',
          birth_date: null,
          created_at: '2026-11-01T00:00:00Z',
        },
      ],
      error: null,
      count: 1,
    },
  });
  render(await Athletes({ params, searchParams: Promise.resolve({ q: 'Jordan' }) }));
  expect(screen.getByRole('table', { name: 'Athlete directory' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'View Jordan Lee' })).toHaveAttribute(
    'href',
    '/app/club/athletes/athlete1',
  );
  expect(screen.queryByText('No matching athletes')).toBeNull();
});
it('handles repeated search/page parameters and preserves the first applied values on retry', async () => {
  current({ athletes: { data: [], error: { code: 'offline' }, count: 0 } });
  render(
    await Athletes({
      params,
      searchParams: Promise.resolve({ q: ['Jordan Lee', 'Other'], page: ['2', '3'] }),
    }),
  );
  const url = new URL(
    screen.getByRole('link', { name: 'Retry athletes' }).getAttribute('href')!,
    'https://example.test',
  );
  expect(url.searchParams.get('q')).toBe('Jordan Lee');
  expect(url.searchParams.get('page')).toBe('2');
});
