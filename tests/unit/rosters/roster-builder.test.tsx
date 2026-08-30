import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      overall: '88.5',
      completedEvaluators: 3,
      expectedEvaluators: 3,
      scoreRange: ['86.0', '91.0'],
      flags: ['needs_another_look'],
      decision: 'undecided',
      teamId: null,
    },
    {
      registrationId: ids.athlete7,
      displayName: 'Athlete 7',
      tryoutNumber: 7,
      positionId: ids.goalie,
      positionName: 'Goalie',
      overall: null,
      completedEvaluators: 0,
      expectedEvaluators: 2,
      scoreRange: null,
      flags: [],
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
    await user.click(screen.getByRole('button', { name: 'Move athlete 42' }));
    await user.selectOptions(screen.getByLabelText('Destination team'), ids.blue);
    await user.click(screen.getByRole('button', { name: 'Confirm move' }));

    expect(onMove).toHaveBeenCalledWith({
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

    await user.selectOptions(screen.getByLabelText('Filter by position'), ids.goalie);
    expect(screen.queryByText('Athlete 42')).not.toBeInTheDocument();
    expect(screen.getByText('Athlete 7')).toBeInTheDocument();
    expect(screen.getByText('Forward target 1 of 1')).toBeInTheDocument();
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

    expect(onFinalize).toHaveBeenCalledWith({ expectedVersion: 4 });
    expect(await screen.findByText('Finalized roster · immutable')).toBeInTheDocument();
    expect(screen.getByText(/No messages were sent by finalization/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move athlete 42' })).not.toBeInTheDocument();
  });

  it('fails closed on a stale version and requires refresh before another write', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn().mockResolvedValue({ ok: false, code: 'conflict', currentVersion: 9 });
    renderBuilder({ onMove });

    await user.click(screen.getByRole('button', { name: 'Move athlete 42' }));
    await user.selectOptions(screen.getByLabelText('Destination team'), ids.white);
    await user.click(screen.getByRole('button', { name: 'Confirm move' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Roster changed elsewhere. Refresh and review version 9 before retrying.',
    );
    expect(screen.getByRole('button', { name: 'Refresh roster' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Move athlete 42' })).not.toBeInTheDocument();
    expect(screen.getByText('Athlete pool 1')).toBeInTheDocument();
  });

  it('recovers controls after a failed network action without changing placement', async () => {
    const user = userEvent.setup();
    renderBuilder({ onMove: vi.fn().mockRejectedValue(new Error('network unavailable')) });

    await user.click(screen.getByRole('button', { name: 'Move athlete 42' }));
    await user.selectOptions(screen.getByLabelText('Destination team'), ids.white);
    await user.click(screen.getByRole('button', { name: 'Confirm move' }));

    expect(
      await screen.findByText('The roster change could not reach the server. Try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move athlete 42' })).toBeEnabled();
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
      expectedVersion: 5,
      reason: 'Correcting a confirmed placement after director review.',
    });
  });

  it('renders finalized roster evidence read-only for an authorized reviewer', () => {
    renderBuilder({
      canEdit: false,
      initial: { ...draft, state: 'finalized', version: 5, finalizedAt: '2026-08-30T10:00:00Z' },
    });
    expect(screen.getByText('Finalized roster · immutable')).toBeInTheDocument();
    expect(screen.getByText(/Recorded in the roster audit trail/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create revision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move athlete 42' })).not.toBeInTheDocument();
  });
});
