import type { DecisionStatus } from '../domain/roster';

export type RosterWorkspaceMember = Readonly<{
  registrationId: string;
  displayName: string;
  tryoutNumber: number | null;
  positionId: string | null;
  positionName: string | null;
  decision: DecisionStatus;
  teamId: string | null;
}>;

export type RosterWorkspaceData = Readonly<{
  rosterVersionId: string;
  state: 'draft' | 'finalized';
  version: number;
  revisionNumber: number;
  basedOnRosterVersionId: string | null;
  revisionReason: string | null;
  finalizedAt: string | null;
  teams: readonly Readonly<{
    id: string;
    name: string;
    targetSize: number | null;
    positionTargets: Readonly<Record<string, number>>;
  }>[];
  positions: readonly Readonly<{ id: string; name: string }>[];
  members: readonly RosterWorkspaceMember[];
}>;

export type RosterWorkspaceResult =
  { outcome: 'ok'; snapshot: RosterWorkspaceData } | { outcome: 'forbidden' | 'invalid_scope' };

export interface RosterWorkspaceGateway {
  load(input: {
    organizationId: string;
    tryoutId: string;
    divisionId: string;
    rosterVersionId: string;
  }): Promise<RosterWorkspaceResult>;
}
