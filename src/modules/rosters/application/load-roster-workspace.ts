import {
  buildRankingRows,
  type RankingGateway,
  type RankingRow,
} from '../../rankings/application/list-rankings';
import type { RosterWorkspaceData, RosterWorkspaceGateway } from './roster-workspace';

export type RosterEvidenceAvailability = 'available' | 'unavailable' | 'not_authorized';
export type LoadedRosterWorkspace =
  | {
      outcome: 'ok';
      snapshot: RosterWorkspaceData;
      evidenceAvailability: RosterEvidenceAvailability;
      rankingRows: readonly RankingRow[];
    }
  | { outcome: 'forbidden' | 'invalid_scope' | 'unavailable' };

export async function loadRosterWorkspace(
  input: {
    organizationId: string;
    tryoutId: string;
    divisionId: string;
    rosterVersionId: string;
  },
  dependencies: { rosters: RosterWorkspaceGateway; rankings: RankingGateway },
): Promise<LoadedRosterWorkspace> {
  let rosterResult;
  try {
    rosterResult = await dependencies.rosters.load(input);
  } catch {
    return { outcome: 'unavailable' };
  }
  if (rosterResult.outcome !== 'ok') return { outcome: rosterResult.outcome };

  try {
    const rankingResult = await dependencies.rankings.load({
      organizationId: input.organizationId,
      tryoutId: input.tryoutId,
      divisionId: input.divisionId,
    });
    if (rankingResult.outcome !== 'ok') {
      return {
        outcome: 'ok',
        snapshot: rosterResult.snapshot,
        evidenceAvailability:
          rankingResult.outcome === 'forbidden' ? 'not_authorized' : 'unavailable',
        rankingRows: [],
      };
    }
    const memberIds = new Set(rosterResult.snapshot.members.map((member) => member.registrationId));
    const rankingRows = buildRankingRows(rankingResult.snapshot).filter(
      (row) => row.divisionId === input.divisionId && memberIds.has(row.registrationId),
    );
    return {
      outcome: 'ok',
      snapshot: rosterResult.snapshot,
      evidenceAvailability: 'available',
      rankingRows,
    };
  } catch {
    return {
      outcome: 'ok',
      snapshot: rosterResult.snapshot,
      evidenceAvailability: 'unavailable',
      rankingRows: [],
    };
  }
}
