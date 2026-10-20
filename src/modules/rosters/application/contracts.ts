import type { DecisionStatus } from '../domain/roster';

export type RosterScope = { organizationId: string; tryoutId: string; divisionId: string };

export type CreateRosterOutcome =
  | { outcome: 'created'; rosterVersionId: string; version: number }
  | { outcome: 'forbidden' | 'invalid_scope' | 'invalid_teams' | 'conflict' | 'unexpected' };
export type VersionedRosterOutcome<TSuccess extends string> =
  | { outcome: TSuccess; version: number }
  | {
      outcome:
        | 'unchanged'
        | 'forbidden'
        | 'confirmation_required'
        | 'invalid_roster'
        | 'invalid_state'
        | 'invalid_registration'
        | 'invalid_team'
        | 'invalid_decisions'
        | 'conflict'
        | 'unexpected';
      version?: number;
    };
export type ReviseRosterOutcome =
  | { outcome: 'revised'; rosterVersionId: string; version: number }
  | { outcome: 'conflict'; version: number }
  | {
      outcome:
        | 'forbidden'
        | 'confirmation_required'
        | 'invalid_reason'
        | 'invalid_roster'
        | 'invalid_state'
        | 'capacity'
        | 'unexpected';
    };

export interface CreateRosterDraftGateway {
  create(
    input: RosterScope & {
      teams: {
        name: string;
        targetSize?: number | null;
        positionTargets?: Record<string, number>;
      }[];
    },
  ): Promise<CreateRosterOutcome>;
}
export interface MoveAthleteGateway {
  move(
    input: RosterScope & {
      rosterVersionId: string;
      registrationId: string;
      teamId: string | null;
      expectedVersion: number;
    },
  ): Promise<VersionedRosterOutcome<'moved'>>;
}
export interface ChangeDecisionGateway {
  change(
    input: RosterScope & {
      rosterVersionId: string;
      changes: { registrationId: string; status: DecisionStatus }[];
      expectedVersion: number;
      confirmation: string;
    },
  ): Promise<VersionedRosterOutcome<'changed'>>;
}
export interface FinalizeRosterGateway {
  finalize(
    input: RosterScope & {
      rosterVersionId: string;
      expectedVersion: number;
      confirmation: string;
    },
  ): Promise<VersionedRosterOutcome<'finalized'>>;
}
export interface ReviseRosterGateway {
  revise(
    input: RosterScope & {
      rosterVersionId: string;
      expectedVersion: number;
      reason: string;
      confirmation: string;
    },
  ): Promise<ReviseRosterOutcome>;
}

export type RosterGateway = CreateRosterDraftGateway &
  MoveAthleteGateway &
  ChangeDecisionGateway &
  FinalizeRosterGateway &
  ReviseRosterGateway;
