import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ErrorState } from '@/components/feedback/error-state';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { buildRankingRows } from '@/modules/rankings/application/list-rankings';
import { SupabaseRankingGateway } from '@/modules/rankings/infrastructure/supabase-ranking-gateway';
import { changeDecision } from '@/modules/rosters/application/change-decision';
import { createRosterDraft } from '@/modules/rosters/application/create-roster-draft';
import { finalizeRoster } from '@/modules/rosters/application/finalize-roster';
import { moveAthlete } from '@/modules/rosters/application/move-athlete';
import { reviseRoster } from '@/modules/rosters/application/revise-roster';
import { decisionStatusSchema } from '@/modules/rosters/domain/roster';
import {
  RosterBuilder,
  RosterDraftSetup,
  type RosterWorkspaceSnapshot,
} from '@/modules/rosters/ui/roster-builder';

const uuid = z.uuid();
const positionTargetsSchema = z.record(z.uuid(), z.number().int().min(0).max(500));

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RostersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const query = await searchParams;
  if (!uuid.safeParse(tryoutId).success) notFound();
  const current = await requireOrganizationRouteContext(organizationSlug);
  const organizationId = current.organization.id;

  const [
    { data: tryout },
    { data: divisions, error: divisionsError },
    { data: versions, error: versionsError },
  ] = await Promise.all([
    current.client
      .from('tryouts')
      .select('id,name,status')
      .eq('organization_id', organizationId)
      .eq('id', tryoutId)
      .maybeSingle(),
    current.client
      .from('tryout_divisions')
      .select('id,name')
      .eq('organization_id', organizationId)
      .eq('tryout_id', tryoutId)
      .order('sort_order'),
    current.client
      .from('roster_versions')
      .select(
        'id,division_id,state,version,revision_number,based_on_roster_version_id,revision_reason,finalized_at',
      )
      .eq('organization_id', organizationId)
      .eq('tryout_id', tryoutId)
      .order('revision_number', { ascending: false }),
  ]);
  if (!tryout) notFound();
  if (divisionsError || versionsError) {
    return (
      <ErrorState
        description="Roster configuration could not be loaded. Refresh and try again."
        title="Roster workspace unavailable"
      />
    );
  }

  const requestedDivision = first(query.division);
  if (requestedDivision !== undefined && !uuid.safeParse(requestedDivision).success) notFound();
  const divisionId =
    requestedDivision ??
    versions?.[0]?.division_id ??
    divisions?.find(
      (division) =>
        requireCapability(current.authorization, 'roster:write', {
          organizationId,
          tryoutId,
          divisionId: division.id,
        }).ok,
    )?.id;
  const division = divisions?.find((candidate) => candidate.id === divisionId);
  if (!division || !divisionId) notFound();
  const selectedDivisionId = divisionId;

  const roster = versions?.find((candidate) => candidate.division_id === divisionId) ?? null;
  const canEdit = requireCapability(current.authorization, 'roster:write', {
    organizationId,
    tryoutId,
    divisionId,
  }).ok;
  const canRead = requireCapability(current.authorization, 'roster:read', {
    organizationId,
    tryoutId,
    divisionId,
    finalized: roster?.state === 'finalized',
  }).ok;
  if (!canRead && !canEdit) notFound();

  const path = `/app/${organizationSlug}/tryouts/${tryoutId}/rosters`;

  async function createAction(input: {
    teams: readonly {
      name: string;
      targetSize: number | null;
      positionTargets: Readonly<Record<string, number>>;
    }[];
  }) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const result = await createRosterDraft(
      {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: selectedDivisionId,
        teams: input.teams,
      },
      scoped.authorization,
    );
    if (!result.ok) return { ok: false as const, code: result.error.code };
    revalidatePath(path);
    return { ok: true as const, ...result.value };
  }

  async function moveAction(input: {
    registrationId: string;
    teamId: string | null;
    expectedVersion: number;
  }) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const { data: currentRoster, error } = await scoped.client
      .from('roster_versions')
      .select('id')
      .eq('organization_id', scoped.organization.id)
      .eq('tryout_id', tryoutId)
      .eq('division_id', selectedDivisionId)
      .eq('state', 'draft')
      .maybeSingle();
    const rosterVersionId = currentRoster?.id;
    if (error || !rosterVersionId) return { ok: false as const, code: 'invalid_roster' };
    const result = await moveAthlete(
      {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: selectedDivisionId,
        rosterVersionId,
        ...input,
      },
      scoped.authorization,
    );
    if (!result.ok)
      return {
        ok: false as const,
        code: result.error.code,
        currentVersion: result.error.currentVersion,
      };
    revalidatePath(path);
    return { ok: true as const, version: result.value.version };
  }

  async function changeAction(input: {
    changes: readonly { registrationId: string; status: z.infer<typeof decisionStatusSchema> }[];
    expectedVersion: number;
  }) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const { data: currentRoster, error } = await scoped.client
      .from('roster_versions')
      .select('id')
      .eq('organization_id', scoped.organization.id)
      .eq('tryout_id', tryoutId)
      .eq('division_id', selectedDivisionId)
      .eq('state', 'draft')
      .maybeSingle();
    const rosterVersionId = currentRoster?.id;
    if (error || !rosterVersionId) return { ok: false as const, code: 'invalid_roster' };
    const result = await changeDecision(
      {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: selectedDivisionId,
        rosterVersionId,
        expectedVersion: input.expectedVersion,
        confirmation: 'CONFIRM DECISIONS',
        changes: input.changes,
      },
      scoped.authorization,
    );
    if (!result.ok)
      return {
        ok: false as const,
        code: result.error.code,
        currentVersion: result.error.currentVersion,
      };
    revalidatePath(path);
    return { ok: true as const, version: result.value.version };
  }

  async function finalizeAction(input: { expectedVersion: number }) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const { data: currentRoster, error } = await scoped.client
      .from('roster_versions')
      .select('id')
      .eq('organization_id', scoped.organization.id)
      .eq('tryout_id', tryoutId)
      .eq('division_id', selectedDivisionId)
      .eq('state', 'draft')
      .maybeSingle();
    const rosterVersionId = currentRoster?.id;
    if (error || !rosterVersionId) return { ok: false as const, code: 'invalid_roster' };
    const result = await finalizeRoster(
      {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: selectedDivisionId,
        rosterVersionId,
        expectedVersion: input.expectedVersion,
        confirmation: 'FINALIZE ROSTER',
      },
      scoped.authorization,
    );
    if (!result.ok)
      return {
        ok: false as const,
        code: result.error.code,
        currentVersion: result.error.currentVersion,
      };
    revalidatePath(path);
    return { ok: true as const, version: result.value.version };
  }

  async function reviseAction(input: { expectedVersion: number; reason: string }) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const { data: currentRoster, error } = await scoped.client
      .from('roster_versions')
      .select('id')
      .eq('organization_id', scoped.organization.id)
      .eq('tryout_id', tryoutId)
      .eq('division_id', selectedDivisionId)
      .eq('state', 'finalized')
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const rosterVersionId = currentRoster?.id;
    if (error || !rosterVersionId) return { ok: false as const, code: 'invalid_roster' };
    const result = await reviseRoster(
      {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: selectedDivisionId,
        rosterVersionId,
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        confirmation: 'REVISE ROSTER',
      },
      scoped.authorization,
    );
    if (!result.ok)
      return {
        ok: false as const,
        code: result.error.code,
        currentVersion: result.error.currentVersion,
      };
    revalidatePath(path);
    return {
      ok: true as const,
      rosterVersionId: result.value.rosterVersionId,
      version: result.value.version,
    };
  }

  const { data: positions, error: positionsError } = await current.client
    .from('tryout_positions')
    .select('id,name')
    .eq('organization_id', organizationId)
    .eq('tryout_id', tryoutId)
    .order('sort_order');

  let content;
  if (!roster) {
    content = positionsError ? (
      <ErrorState
        description="Roster positions could not be loaded. Refresh and try again."
        title="Roster workspace unavailable"
      />
    ) : canEdit ? (
      <RosterDraftSetup
        divisionName={division.name}
        onCreate={createAction}
        positions={positions ?? []}
      />
    ) : (
      <ErrorState
        description="No finalized roster is available in your assigned scope."
        title="Roster unavailable"
      />
    );
  } else {
    const [teamsResult, assignmentsResult, decisionsResult, rankingResult] = await Promise.all([
      current.client
        .from('tryout_teams')
        .select('id,name,target_size,position_targets')
        .eq('organization_id', organizationId)
        .eq('tryout_id', tryoutId)
        .eq('division_id', divisionId)
        .order('sort_order'),
      current.client
        .from('roster_assignments')
        .select('registration_id,team_id')
        .eq('organization_id', organizationId)
        .eq('roster_version_id', roster.id),
      current.client
        .from('roster_decisions')
        .select('registration_id,status')
        .eq('organization_id', organizationId)
        .eq('roster_version_id', roster.id),
      new SupabaseRankingGateway(current.client).load({ organizationId, tryoutId, divisionId }),
    ]);
    if (
      positionsError ||
      teamsResult.error ||
      assignmentsResult.error ||
      decisionsResult.error ||
      rankingResult.outcome !== 'ok'
    ) {
      content = (
        <ErrorState
          description="Authorized roster or ranking evidence could not be loaded. Refresh or verify your current assignment scope."
          title="Roster workspace unavailable"
        />
      );
    } else {
      const rankingByRegistration = new Map(
        buildRankingRows(rankingResult.snapshot).map((row) => [row.registrationId, row]),
      );
      const teamByRegistration = new Map(
        assignmentsResult.data.map((row) => [row.registration_id, row.team_id]),
      );
      const safeTeams = teamsResult.data.flatMap((team) => {
        const targets = positionTargetsSchema.safeParse(team.position_targets);
        return targets.success
          ? [
              {
                id: team.id,
                name: team.name,
                targetSize: team.target_size,
                positionTargets: targets.data,
              },
            ]
          : [];
      });
      if (safeTeams.length !== teamsResult.data.length) {
        content = (
          <ErrorState
            description="Roster team targets are invalid and could not be displayed safely."
            title="Roster workspace unavailable"
          />
        );
      } else {
        const safeDecisions = decisionsResult.data.flatMap((decision) => {
          const status = decisionStatusSchema.safeParse(decision.status);
          if (!status.success) return [];
          return [{ registrationId: decision.registration_id, status: status.data }];
        });
        const teamIds = new Set(safeTeams.map((team) => team.id));
        const hasInvalidAssignment = assignmentsResult.data.some(
          (assignment) => assignment.team_id !== null && !teamIds.has(assignment.team_id),
        );
        if (safeDecisions.length !== decisionsResult.data.length || hasInvalidAssignment) {
          content = (
            <ErrorState
              description="Roster decisions or placements are invalid and could not be displayed safely."
              title="Roster workspace unavailable"
            />
          );
        } else {
          const athletes = safeDecisions.map((decision) => {
            const ranking = rankingByRegistration.get(decision.registrationId);
            return {
              registrationId: decision.registrationId,
              displayName: ranking?.displayName ?? 'Athlete details unavailable',
              tryoutNumber: ranking?.tryoutNumber ?? null,
              positionId: ranking?.positionId ?? null,
              positionName: ranking?.positionName ?? null,
              overall: ranking?.overall ?? null,
              completedEvaluators: ranking?.completedEvaluators ?? 0,
              expectedEvaluators: ranking?.expectedEvaluators ?? 0,
              scoreRange: ranking?.scoreRange ?? null,
              flags: ranking?.flags ?? [],
              decision: decision.status,
              teamId: teamByRegistration.get(decision.registrationId) ?? null,
            };
          });
          const snapshot: RosterWorkspaceSnapshot = {
            rosterVersionId: roster.id,
            state: roster.state === 'finalized' ? 'finalized' : 'draft',
            version: roster.version,
            revisionNumber: roster.revision_number,
            basedOnRosterVersionId: roster.based_on_roster_version_id,
            revisionReason: roster.revision_reason,
            finalizedAt: roster.finalized_at,
            teams: safeTeams,
            positions: positions ?? [],
            athletes,
          };
          content = (
            <RosterBuilder
              canEdit={canEdit}
              initial={snapshot}
              onChangeDecisions={changeAction}
              onFinalize={finalizeAction}
              onMove={moveAction}
              onRevise={reviseAction}
            />
          );
        }
      }
    }
  }

  return (
    <section aria-labelledby="roster-heading" className="min-w-0">
      <p className="eyebrow">Human decisions</p>
      <h2 id="roster-heading">{tryout.name} rosters</h2>
      <p className="mb-4 mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Build and confirm one division roster at a time. Finalizing preserves history and does not
        communicate or export anything.
      </p>
      {divisions && divisions.length > 1 ? (
        <nav aria-label="Roster divisions" className="mb-5 flex min-w-0 flex-wrap gap-2">
          {divisions.map((candidate) => (
            <Link
              aria-current={candidate.id === divisionId ? 'page' : undefined}
              className="inline-flex min-h-11 min-w-0 items-center rounded-[var(--radius-control)] border border-[var(--color-border)] px-4 font-bold aria-[current=page]:border-[var(--color-primary)] aria-[current=page]:text-[var(--color-primary)]"
              href={`?division=${candidate.id}`}
              key={candidate.id}
            >
              {candidate.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {content}
    </section>
  );
}
