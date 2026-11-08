import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OrganizationRole,
  StaffAssignment,
} from '../../../src/modules/organizations/domain/roles';

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  workspace: vi.fn(),
  billing: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('../../../src/modules/organizations/application/current-organization', () => ({
  requireCurrentOrganization: mocks.current,
}));
vi.mock('../../../src/modules/organizations/application/team-workspaces', () => ({
  loadWorkspaceNavigation: mocks.workspace,
}));
vi.mock('../../../src/modules/subscriptions/ui/server-feature-gate', () => ({
  billingUpgradePrompt: mocks.billing,
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.capture,
}));

import NewTryoutPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/new/page';
import SettingsPage from '../../../src/app/(app)/app/[organizationSlug]/organization/settings/page';
import SetupPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/setup/[step]/page';

const organizationId = '10000000-0000-4000-8000-000000000001';
const tryoutId = '10000000-0000-4000-8000-000000000002';
const userId = '10000000-0000-4000-8000-000000000003';
const params = Promise.resolve({ organizationSlug: 'club' });
const setupParams = Promise.resolve({ organizationSlug: 'club', tryoutId, step: 'basics' });
const searchParams = Promise.resolve({});

function current(organizationRole: OrganizationRole, assignments: StaffAssignment[] = []) {
  const client = {
    from: vi.fn(() => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        maybeSingle: vi.fn(),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.order.mockResolvedValue({ data: [], error: null });
      query.maybeSingle.mockResolvedValue({ data: null, error: { code: 'offline' } });
      return query;
    }),
    rpc: vi.fn(),
  };
  mocks.current.mockResolvedValue({
    organization: {
      id: organizationId,
      slug: 'club',
      name: 'Club',
      timezone: 'America/Edmonton',
      terminology: { athlete: 'Skater', athletes: 'Skaters' },
      sportDefaults: ['Hockey'],
      tagDefaults: ['Teamwork'],
    },
    authorization: {
      userId,
      organizationId,
      organizationRole,
      membershipStatus: 'active',
      assignments,
    },
    userId,
    client,
  });
  return client;
}
const staffCases: [string, StaffAssignment[]][] = [
  ['member', []],
  ['director', [{ role: 'director', scope: { kind: 'tryout', tryoutId } }]],
  [
    'evaluator',
    [{ role: 'evaluator', scope: { kind: 'session', tryoutId, sessionId: 'session' } }],
  ],
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace.mockResolvedValue({ parent: null });
  mocks.billing.mockResolvedValue(null);
});

describe('staff direct-entry page permissions', () => {
  it.each(staffCases)(
    'does not expose draft creation or recovery to %s',
    async (_role, assignments) => {
      const client = current('member', assignments);
      render(await NewTryoutPage({ params }));
      expect(
        screen.getByRole('heading', { level: 1, name: 'Tryout creation restricted' }),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Back to your work' })).toHaveAttribute(
        'href',
        '/app/club/home',
      );
      expect(screen.queryByRole('textbox', { name: 'Tryout name' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Create draft|Enable recovery/ }),
      ).not.toBeInTheDocument();
      expect(client.from).not.toHaveBeenCalled();
      expect(mocks.billing).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'administrator'] as const)('keeps creation available to %s', async (role) => {
    current(role);
    render(await NewTryoutPage({ params }));
    expect(screen.getByRole('heading', { name: 'Create a tryout' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Tryout name' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeVisible();
  });

  it.each(staffCases)(
    'shows saved settings without editing or billing controls to %s',
    async (_role, assignments) => {
      const client = current('member', assignments);
      const view = render(await SettingsPage({ params, searchParams }));
      expect(screen.getByRole('heading', { name: 'Organization settings' })).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Read-only settings' })).toBeVisible();
      expect(screen.getByText(/owner or administrator can change/i)).toBeVisible();
      for (const value of ['America/Edmonton', 'Skater', 'Skaters', 'Hockey', 'Teamwork']) {
        expect(screen.getByText(value, { selector: 'dd' })).toBeVisible();
      }
      expect(screen.getByRole('link', { name: 'Back to your work' })).toHaveAttribute(
        'href',
        '/app/club/home',
      );
      expect(view.container.querySelector('form,input,textarea,select')).toBeNull();
      expect(
        screen.queryByRole('button', { name: /Save settings|Upload logo|Replace logo/ }),
      ).not.toBeInTheDocument();
      expect(client.from).not.toHaveBeenCalled();
      expect(mocks.billing).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'administrator'] as const)('keeps settings editable for %s', async (role) => {
    current(role);
    render(await SettingsPage({ params, searchParams }));
    expect(screen.getByRole('textbox', { name: 'Timezone' })).toHaveValue('America/Edmonton');
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Upload logo' })).toBeVisible();
  });

  it.each([
    [
      'evaluator',
      [{ role: 'evaluator', scope: { kind: 'session', tryoutId, sessionId: 'session' } }],
    ],
    [
      'director outside assignment',
      [{ role: 'director', scope: { kind: 'tryout', tryoutId: 'other-event' } }],
    ],
  ] as [string, StaffAssignment[]][])(
    'explains denied setup before loading data for %s',
    async (_role, assignments) => {
      const client = current('member', assignments);
      render(await SetupPage({ params: setupParams, searchParams }));
      expect(
        screen.getByRole('heading', { level: 1, name: 'Tryout setup restricted' }),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Back to your work' })).toHaveAttribute(
        'href',
        '/app/club/home',
      );
      expect(
        screen.queryByText(/temporarily unavailable|Refresh before making changes/i),
      ).not.toBeInTheDocument();
      expect(client.from).not.toHaveBeenCalled();
      expect(client.rpc).not.toHaveBeenCalled();
      expect(mocks.billing).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['owner', 'owner', []],
    ['administrator', 'administrator', []],
    ['assigned director', 'member', [{ role: 'director', scope: { kind: 'tryout', tryoutId } }]],
  ] as [string, OrganizationRole, StaffAssignment[]][])(
    'keeps real setup load failures distinct for %s',
    async (_label, role, assignments) => {
      current(role, assignments);
      render(await SetupPage({ params: setupParams, searchParams }));
      expect(screen.getByRole('heading', { name: 'Setup temporarily unavailable' })).toBeVisible();
      expect(
        screen.queryByRole('heading', { name: 'Tryout setup restricted' }),
      ).not.toBeInTheDocument();
      expect(mocks.capture).toHaveBeenCalledOnce();
    },
  );
});
