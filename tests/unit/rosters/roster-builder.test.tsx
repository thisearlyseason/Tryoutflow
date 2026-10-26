import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  RosterBuilder,
  RosterDraftSetup,
  resolveRosterDrop,
  type RosterWorkspaceSnapshot,
} from '../../../src/modules/rosters/ui/roster-builder';

const ids = {
  roster: '10000000-0000-4000-8000-000000000001',
  forward: '10000000-0000-4000-8000-000000000002',
  goalie: '10000000-0000-4000-8000-000000000003',
  blue: '10000000-0000-4000-8000-000000000004',
  white: '10000000-0000-4000-8000-000000000005',
  athlete42: '10000000-0000-4000-8000-000000000006',
  athlete7: '10000000-0000-4000-8000-000000000007',
};

const draft: RosterWorkspaceSnapshot = {
  rosterVersionId: ids.roster,
  state: 'draft',
  version: 4,
  revisionNumber: 1,
  basedOnRosterVersionId: null,
  revisionReason: null,
  finalizedAt: null,
  evidenceAvailability: 'available',
  teams: [
    {
      id: ids.blue,
      name: 'Blue',
      targetSize: 2,
      positionTargets: { [ids.forward]: 1 },
    },
    { id: ids.white, name: 'White', targetSize: 1, positionTargets: {} },
  ],
  positions: [
    { id: ids.forward, name: 'Forward' },
    { id: ids.goalie, name: 'Goalie' },
  ],
  athletes: [
    {
      registrationId: ids.athlete42,
      displayName: 'Athlete 42',
      tryoutNumber: 42,
      positionId: ids.forward,
      positionName: 'Forward',
      rankingEvidence: {
        status: 'available',
        overall: '88.5',
        completedEvaluators: 3,
        expectedEvaluators: 3,
        scoreRange: ['86.0', '91.0'],
        flags: ['needs_another_look'],
      },
      decision: 'undecided',
      teamId: null,
    },
    {
      registrationId: ids.athlete7,
      displayName: 'Athlete 7',
      tryoutNumber: 7,
      positionId: ids.goalie,
      positionName: 'Goalie',
      rankingEvidence: {
        status: 'available',
        overall: null,
        completedEvaluators: 0,
        expectedEvaluators: 2,
        scoreRange: null,
        flags: [],
      },
      decision: 'waitlisted',
      teamId: ids.blue,
    },
  ],
};

function renderBuilder(overrides: Partial<React.ComponentProps<typeof RosterBuilder>> = {}) {
  const onMove = vi.fn().mockResolvedValue({ ok: true, version: 5 });
  const onChangeDecisions = vi.fn().mockResolvedValue({ ok: true, version: 5 });
  const onFinalize = vi.fn().mockResolvedValue({ ok: true, version: 5 });
  const onRevise = vi.fn().mockResolvedValue({
    ok: true,
    rosterVersionId: '10000000-0000-4000-8000-000000000099',
    version: 1,
  });
  render(
    <RosterBuilder
      canEdit
      initial={draft}
      onChangeDecisions={onChangeDecisions}
      onFinalize={onFinalize}
      onMove={onMove}
      onRevise={onRevise}
      {...overrides}
    />,
  );
  return { onMove, onChangeDecisions, onFinalize, onRevise };
}

describe('RosterBuilder', () => {
  it('creates a draft with explicit team and position targets without inventing decisions', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({
      ok: true,
      rosterVersionId: ids.roster,
      version: 1,
    });
    render(
      <RosterDraftSetup
        divisionName="U15"
        onCreate={onCreate}
        positions={[{ id: ids.forward, name: 'Forward' }]}
      />,
    );
    await user.type(screen.getByLabelText('Team 1 name'), 'Blue');
    await user.type(screen.getByLabelText('Team 1 roster target'), '18');
    await user.type(screen.getByLabelText('Team 1 Forward target'), '10');
    await user.type(screen.getByLabelText('Team 2 name'), 'White');
    await user.click(screen.getByRole('button', { name: 'Create draft roster' }));

    expect(onCreate).toHaveBeenCalledWith({
      teams: [
        { name: 'Blue', targetSize: 18, positionTargets: { [ids.forward]: 10 } },
        { name: 'White', targetSize: null, positionTargets: {} },
      ],
    });
    expect(screen.queryByText(/selected|released/i)).not.toBeInTheDocument();
  });

  it('moves through the explicit dialog and updates counts only after server success', async () => {
    const user = userEvent.setup();
    const { onMove } = renderBuilder();

    expect(screen.getByText('Blue roster 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move Athlete 42' }));
    await user.selectOptions(screen.getByLabelText('Destination team'), ids.blue);
    await user.click(screen.getByRole('button', { name: 'Confirm move' }));

    expect(onMove).toHaveBeenCalledWith({
      rosterVersionId: ids.roster,
      registrationId: ids.athlete42,
      teamId: ids.blue,
      expectedVersion: 4,
    });
    expect(await screen.findByText('Blue roster 2 of 2')).toBeInTheDocument();
  });

  it('maps pointer and touch drop destinations to the same move payload', () => {
    expect(
      resolveRosterDrop({
        active: { id: ids.athlete42 },
        over: { id: `destination:${ids.blue}` },
      }),
    ).toEqual({
      registrationId: ids.athlete42,
      teamId: ids.blue,
    });
  });

  it('filters by position while preserving truthful evidence and target counts', async () => {
    const user = userEvent.setup();
    renderBuilder({
      initial: {
        ...draft,
        athletes: draft.athletes.map((athlete) =>
          athlete.registrationId === ids.athlete42 ? { ...athlete, teamId: ids.blue } : athlete,
        ),
      },
    });

    expect(screen.getByTestId(`roster-athlete-${ids.athlete42}`)).toHaveTextContent('88.5 / 100');
    expect(screen.getByText('3 of 3 evaluations')).toBeInTheDocument();
    expect(screen.getByText('Needs another look')).toBeInTheDocument();
    expect(screen.getByText('Forward target 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Decision room')).toBeInTheDocument();
    expect(screen.getByTestId(`roster-athlete-${ids.athlete42}`)).toHaveClass(
      'roster-athlete-card',
    );

    await user.selectOptions(screen.getByLabelText('Filter by position'), ids.goalie);
    expect(screen.queryByText('Athlete 42')).not.toBeInTheDocument();
    expect(screen.getByText('Athlete 7')).toBeInTheDocument();
    expect(screen.getByText('Blue roster 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('1 visible with this filter')).toBeInTheDocument();
    expect(screen.getByText('Forward target 1 of 1')).toBeInTheDocument();
  });

  it('distinguishes filtered empty regions from truly empty roster regions', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.selectOptions(screen.getByLabelText('Filter by position'), ids.goalie);

    expect(
      within(screen.getByTestId('roster-destination-pool')).getByRole('status'),
    ).toHaveTextContent('No athletes match this filter.');
    expect(
      within(screen.getByTestId(`roster-destination-${ids.white}`)).getByText(
        'No athletes assigned.',
      ),
    ).toBeInTheDocument();
  });

  it('requires an explicit review before a bulk release decision', async () => {
    const user = userEvent.setup();
    const { onChangeDecisions } = renderBuilder();

    await user.click(screen.getByLabelText('Select Athlete 42'));
    await user.selectOptions(screen.getByLabelText('Bulk decision'), 'released');
    await user.click(screen.getByRole('button', { name: 'Review decision for 1 athlete' }));

    expect(onChangeDecisions).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Confirm bulk release' });
    expect(dialog).toHaveTextContent('does not send a message');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm release' }));
    expect(onChangeDecisions).toHaveBeenCalledWith({
      rosterVersionId: ids.roster,
      changes: [{ registrationId: ids.athlete42, status: 'released' }],
      expectedVersion: 4,
    });
  });

  it('explains immutable finalization and never offers or triggers communication', async () => {
    const user = userEvent.setup();
    const { onFinalize } = renderBuilder();

    await user.click(screen.getByRole('button', { name: 'Finalize roster' }));
    const dialog = screen.getByRole('dialog', { name: 'Finalize roster version' });
    expect(dialog).toHaveTextContent('does not send athlete or guardian messages');
    expect(dialog).toHaveTextContent('new audited revision');
    expect(dialog).not.toHaveTextContent('Send messages');
    await user.click(within(dialog).getByLabelText('I understand this roster becomes immutable'));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm finalization' }));

    expect(onFinalize).toHaveBeenCalledWith({ rosterVersionId: ids.roster, expectedVersion: 4 });
    expect(await screen.findByText('Finalized roster · immutable')).toBeInTheDocument();
    expect(screen.getByText(/No messages were sent by finalization/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Athlete 42' })).not.toBeInTheDocument();
  });

  it('fails closed on a stale version and requires refresh before another write', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({ ok: false, code: 'conflict', currentVersion: 9 });
    renderBuilder({ onMove });

    await user.click(screen.getByRole('button', { name: 'Move Athlete 42' }));
    await user.selectOptions(screen.getByLabelText('Destination team'), ids.white);
    await user.click(screen.getByRole('button', { name: 'Confirm move' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Roster changed elsewhere. Refresh and review version 9 before retrying.',
    );
    expect(screen.getByRole('button', { name: 'Refresh roster' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Move Athlete 42' })).not.toBeInTheDocument();
    expect(screen.getByText('Athlete pool 1')).toBeInTheDocument();
  });

  it('recovers controls after a failed network action without changing placement', async () => {
    const user = userEvent.setup();
    renderBuilder({ onMove: vi.fn().mockRejectedValue(new Error('network unavailable')) });

    await user.click(screen.getByRole('button', { name: 'Move Athlete 42' }));
    await user.selectOptions(screen.getByLabelText('Destination team'), ids.white);
    await user.click(screen.getByRole('button', { name: 'Confirm move' }));

    expect(
      await screen.findByText('The roster change could not reach the server. Try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Athlete 42' })).toBeEnabled();
    expect(screen.getByText('Athlete pool 1')).toBeInTheDocument();
  });

  it('creates an audited revision from a finalized snapshot with a bounded reason', async () => {
    const user = userEvent.setup();
    const finalized: RosterWorkspaceSnapshot = {
      ...draft,
      state: 'finalized',
      version: 5,
      finalizedAt: '2026-08-30T10:00:00.000Z',
    };
    const { onRevise } = renderBuilder({ initial: finalized });

    await user.click(screen.getByRole('button', { name: 'Create revision' }));
    const dialog = screen.getByRole('dialog', { name: 'Create roster revision' });
    await user.type(
      within(dialog).getByLabelText('Revision reason'),
      'Correcting a confirmed placement after director review.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm revision' }));

    expect(onRevise).toHaveBeenCalledWith({
      rosterVersionId: ids.roster,
      expectedVersion: 5,
      reason: 'Correcting a confirmed placement after director review.',
    });
  });

  it('closes the bulk dialog and focuses live recovery after a stale response', async () => {
    const user = userEvent.setup();
    renderBuilder({
      onChangeDecisions: vi.fn().mockResolvedValue({
        ok: false,
        code: 'conflict',
        currentVersion: 9,
      }),
    });

    await user.click(screen.getByLabelText('Select Athlete 42'));
    await user.click(screen.getByRole('button', { name: 'Review decision for 1 athlete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm decisions' }));

    expect(screen.queryByRole('dialog', { name: /Confirm bulk/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Refresh roster' })).toBeVisible();
  });

  it('closes the finalization dialog and focuses live recovery after a stale response', async () => {
    const user = userEvent.setup();
    renderBuilder({
      onFinalize: vi.fn().mockResolvedValue({ ok: false, code: 'conflict', currentVersion: 9 }),
    });

    await user.click(screen.getByRole('button', { name: 'Finalize roster' }));
    await user.click(screen.getByLabelText('I understand this roster becomes immutable'));
    await user.click(screen.getByRole('button', { name: 'Confirm finalization' }));

    expect(
      screen.queryByRole('dialog', { name: 'Finalize roster version' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveFocus();
  });

  it('treats an exact old-revision invalid state as stale recovery', async () => {
    const user = userEvent.setup();
    renderBuilder({
      onFinalize: vi.fn().mockResolvedValue({ ok: false, code: 'invalid_state' }),
    });

    await user.click(screen.getByRole('button', { name: 'Finalize roster' }));
    await user.click(screen.getByLabelText('I understand this roster becomes immutable'));
    await user.click(screen.getByRole('button', { name: 'Confirm finalization' }));

    expect(
      screen.queryByRole('dialog', { name: 'Finalize roster version' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Refresh and review the current roster before retrying',
    );
  });

  it('closes the revision dialog and focuses live recovery after a stale response', async () => {
    const user = userEvent.setup();
    renderBuilder({
      initial: { ...draft, state: 'finalized', version: 5 },
      onRevise: vi.fn().mockResolvedValue({ ok: false, code: 'conflict', currentVersion: 9 }),
    });

    await user.click(screen.getByRole('button', { name: 'Create revision' }));
    await user.type(
      screen.getByLabelText('Revision reason'),
      'Correcting a confirmed placement after director review.',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm revision' }));

    expect(
      screen.queryByRole('dialog', { name: 'Create roster revision' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveFocus();
  });

  it('keeps unavailable ranking evidence explicit on every affected athlete card', () => {
    renderBuilder({
      initial: {
        ...draft,
        evidenceAvailability: 'unavailable',
        athletes: [
          {
            registrationId: ids.athlete42,
            displayName: 'Submitted Snapshot Member',
            tryoutNumber: 42,
            positionId: ids.forward,
            positionName: 'Forward',
            rankingEvidence: { status: 'unavailable' },
            decision: 'undecided',
            teamId: null,
          },
        ],
      } as RosterWorkspaceSnapshot,
    });

    const card = screen.getByTestId(`roster-athlete-${ids.athlete42}`);
    expect(within(card).getByText('Ranking evidence unavailable')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('0 of 0 evaluations');
    expect(card).not.toHaveTextContent('No score');
    expect(card).not.toHaveTextContent('Range not available');
    expect(screen.getByRole('status', { name: 'Ranking evidence unavailable' })).toHaveTextContent(
      'Roster membership, placements, and decisions remain available',
    );
    expect(screen.getByRole('button', { name: 'Move Submitted Snapshot Member' })).toBeEnabled();
  });

  it('does not turn a member missing from a successful ranking projection into zero evidence', () => {
    renderBuilder({
      initial: {
        ...draft,
        evidenceAvailability: 'available',
        athletes: [
          {
            registrationId: ids.athlete42,
            displayName: 'Projection Missing Member',
            tryoutNumber: 42,
            positionId: ids.forward,
            positionName: 'Forward',
            rankingEvidence: { status: 'unavailable' },
            decision: 'undecided',
            teamId: null,
          },
        ],
      } as RosterWorkspaceSnapshot,
    });

    const card = screen.getByTestId(`roster-athlete-${ids.athlete42}`);
    expect(within(card).getByText('Ranking evidence unavailable')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('0 of 0 evaluations');
    expect(screen.queryByRole('status', { name: 'Ranking evidence unavailable' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Projection Missing Member' })).toBeEnabled();
  });

  it('distinguishes not-authorized evidence from an actual zero-coverage ranking row', () => {
    renderBuilder({
      initial: {
        ...draft,
        athletes: [
          {
            ...draft.athletes[0]!,
            rankingEvidence: { status: 'not_authorized' },
          },
          {
            ...draft.athletes[1]!,
            rankingEvidence: {
              status: 'available',
              overall: null,
              completedEvaluators: 0,
              expectedEvaluators: 0,
              scoreRange: null,
              flags: [],
            },
          },
        ],
      } as RosterWorkspaceSnapshot,
    });

    expect(
      within(screen.getByTestId(`roster-athlete-${ids.athlete42}`)).getByText(
        'Ranking evidence not authorized',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`roster-athlete-${ids.athlete7}`)).getByText('0 of 0 evaluations'),
    ).toBeInTheDocument();
  });

  it('renders finalized roster evidence read-only for an authorized reviewer', () => {
    renderBuilder({
      canEdit: false,
      initial: { ...draft, state: 'finalized', version: 5, finalizedAt: '2026-08-30T10:00:00Z' },
    });
    expect(screen.getByText('Finalized roster · immutable')).toBeInTheDocument();
    expect(screen.getByText(/Recorded in the roster audit trail/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create revision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move Athlete 42' })).not.toBeInTheDocument();
  });

  it('hydrates finalized audit evidence identically across locale and timezone boundaries', async () => {
    const originalDateLocaleString = Date.prototype.toLocaleString;
    let renderEnvironment: 'server' | 'client' = 'server';
    const dateLocaleSpy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
      this: Date,
      ...args: Parameters<Date['toLocaleString']>
    ) {
      if (this.toISOString() === '2026-08-30T10:00:00.000Z') {
        return renderEnvironment === 'server' ? '8/30/2026, 10:00:00 AM' : '30.08.2026 04:00:00';
      }
      return originalDateLocaleString.apply(this, args);
    });
    const names = ['İPEK', 'I\u0307PEK', 'Élodie', 'E\u0301lodie', 'McKay'];
    const finalized = {
      ...draft,
      state: 'finalized' as const,
      version: 5,
      finalizedAt: '2026-08-30T10:00:00.000Z',
      athletes: names.map((displayName, index) => ({
        ...draft.athletes[index % draft.athletes.length]!,
        registrationId: `10000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
        displayName,
      })),
    };
    const callbacks = {
      onMove: vi.fn(),
      onChangeDecisions: vi.fn(),
      onFinalize: vi.fn(),
      onRevise: vi.fn(),
    };
    const element = <RosterBuilder canEdit initial={finalized} {...callbacks} />;
    const container = document.createElement('div');
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    const consoleErrors: unknown[][] = [];
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => consoleErrors.push(args));
    const reactActEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    let root: Root | undefined;

    try {
      const serverMarkup = renderToString(element);
      renderEnvironment = 'client';
      expect(renderToString(element)).toBe(serverMarkup);
      container.innerHTML = serverMarkup;

      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
      });

      expect(recoverableErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(container.querySelector('time')).toHaveAttribute(
        'datetime',
        '2026-08-30T10:00:00.000Z',
      );
      expect(container.querySelector('time')).toHaveTextContent('2026-08-30 10:00:00 UTC');
      for (const name of names) {
        const heading = within(container).getByRole('heading', { name });
        expect(heading.textContent).toBe(name);
        expect(heading).toHaveAccessibleName(name);
      }
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      consoleErrorSpy.mockRestore();
      dateLocaleSpy.mockRestore();
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  it('fails safely when a finalized audit timestamp is invalid', () => {
    renderBuilder({
      canEdit: false,
      initial: { ...draft, state: 'finalized', version: 5, finalizedAt: 'not-a-timestamp' },
    });

    expect(screen.getByText(/Recorded in the roster audit trail/u)).toHaveTextContent(
      'Finalization time unavailable.',
    );
    expect(screen.queryByRole('time')).not.toBeInTheDocument();
  });

  it.each([
    ['Turkish dotted I', 'İPEK'],
    ['decomposed Turkish dotted I', 'I\u0307PEK'],
    ['NFC accent', 'Élodie'],
    ['NFD accent', 'E\u0301lodie'],
    ['mixed case', 'McKay'],
    ['leading and trailing whitespace', '  Ana María  '],
    ['significant internal whitespace', 'Ana  María'],
  ])(
    'renders the authorized %s display name verbatim in every roster identity label',
    async (_, displayName) => {
      const user = userEvent.setup();
      renderBuilder({
        initial: {
          ...draft,
          athletes: [{ ...draft.athletes[0]!, displayName }],
        },
      });

      const card = screen.getByTestId(`roster-athlete-${ids.athlete42}`);
      const heading = within(card).getByRole('heading');
      const buttons = within(card).getAllByRole('button');
      const drag = buttons.find(
        (button) => button.getAttribute('aria-label') === `Drag ${displayName}`,
      );
      const select = within(card).getByText(
        (_, element) =>
          element?.tagName === 'LABEL' && element.textContent === `Select ${displayName}`,
      );
      const move = buttons.find((button) => button.textContent === `Move ${displayName}`);

      expect(heading.textContent).toBe(displayName);
      expect(heading).toHaveAccessibleName(displayName.trim().replaceAll(/\s+/gu, ' '));
      expect(drag).toHaveAttribute('aria-label', `Drag ${displayName}`);
      expect(select.textContent).toBe(`Select ${displayName}`);
      expect(move).toBeDefined();
      expect(move).toHaveAttribute('aria-label', `Move ${displayName}`);
      expect(move?.textContent).toBe(`Move ${displayName}`);

      await user.click(move!);
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading').textContent).toBe(`Move ${displayName}`);
    },
  );
});
