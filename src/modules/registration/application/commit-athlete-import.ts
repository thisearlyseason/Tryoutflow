import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

export type AthleteImportCommitResult =
  | { outcome: 'committed' | 'replayed'; athleteIds: string[] }
  | { outcome: 'expired' | 'conflict' | 'invalid_selection'; athleteIds: [] };

export type CommitAthleteImportGateway = {
  commit(input: {
    organizationId: string;
    previewId: string;
    selectedRows: number[];
    actorUserId: string;
  }): Promise<AthleteImportCommitResult>;
};

export async function commitAthleteImport(
  input: {
    organizationId: string;
    previewId: string;
    selectedRows: number[];
    actor: AuthorizationContext;
  },
  gateway: CommitAthleteImportGateway,
): Promise<AthleteImportCommitResult> {
  if (
    !requireCapability(input.actor, 'athlete:write', {
      organizationId: input.organizationId as AuthorizationContext['organizationId'],
    }).ok
  )
    throw { code: 'forbidden' as const };
  if (
    input.selectedRows.length < 1 ||
    input.selectedRows.length > 500 ||
    new Set(input.selectedRows).size !== input.selectedRows.length ||
    input.selectedRows.some((row) => !Number.isSafeInteger(row) || row < 2)
  )
    throw { code: 'invalid_selection' as const };
  return gateway.commit({
    organizationId: input.organizationId,
    previewId: input.previewId,
    selectedRows: [...input.selectedRows].sort((left, right) => left - right),
    actorUserId: input.actor.userId,
  });
}
