import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ErrorState } from '@/components/feedback/error-state';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { SupabaseRankingGateway } from '@/modules/rankings/infrastructure/supabase-ranking-gateway';
import { RosterExportLink } from '@/modules/integrations/ui/roster-export-link';
import { changeDecision } from '@/modules/rosters/application/change-decision';
import { createRosterDraft } from '@/modules/rosters/application/create-roster-draft';
import { finalizeRoster } from '@/modules/rosters/application/finalize-roster';
import {
  loadRosterWorkspace,
  rankingEvidenceForRosterMember,
} from '@/modules/rosters/application/load-roster-workspace';
import { moveAthlete } from '@/modules/rosters/application/move-athlete';
import { reviseRoster } from '@/modules/rosters/application/revise-roster';
import {
  bindChangeRosterActionInput,
  bindCreateRosterActionInput,
  bindFinalizeRosterActionInput,
  bindMoveRosterActionInput,
  bindReviseRosterActionInput,
} from '@/modules/rosters/application/roster-action-boundary';
import { SupabaseRosterWorkspaceGateway } from '@/modules/rosters/infrastructure/supabase-roster-workspace-gateway';
import {
  RosterBuilder,
  RosterDraftSetup,
  type RosterWorkspaceSnapshot,
} from '@/modules/rosters/ui/roster-builder';
import { TryoutJourneyNavigation } from '@/modules/tryouts/ui/tryout-journey';

const uuid = z.uuid();

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
  const canExport = requireCapability(current.authorization, 'integration:manage', {
    organizationId,
  }).ok;
  if (!canRead && !canEdit) notFound();

  async function createAction(input: unknown) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const bound = bindCreateRosterActionInput(input, {
      organizationId: scoped.organization.id,
      tryoutId,
      divisionId: selectedDivisionId,
    });
    if (!bound.ok) return { ok: false as const, code: 'invalid_input' };
    const result = await createRosterDraft(bound.data, scoped.authorization);
    if (!result.ok) return { ok: false as const, code: result.error.code };
    return { ok: true as const, ...result.value };
  }

  async function moveAction(input: unknown) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const bound = bindMoveRosterActionInput(input, {
      organizationId: scoped.organization.id,
      tryoutId,
      divisionId: selectedDivisionId,
    });
    if (!bound.ok) return { ok: false as const, code: 'invalid_input' };
    const result = await moveAthlete(
      {
        organizationId: bound.data.organizationId,
        tryoutId: bound.data.tryoutId,
        divisionId: bound.data.divisionId,
        rosterVersionId: bound.data.rosterVersionId,
        registrationId: bound.data.registrationId,
        teamId: bound.data.teamId,
        expectedVersion: bound.data.expectedVersion,
      },
      scoped.authorization,
    );
    if (!result.ok)
      return {
        ok: false as const,
        code: result.error.code,
        currentVersion: result.error.currentVersion,
      };
    return { ok: true as const, version: result.value.version };
  }

  async function changeAction(input: unknown) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const bound = bindChangeRosterActionInput(input, {
      organizationId: scoped.organization.id,
      tryoutId,
      divisionId: selectedDivisionId,
    });
    if (!bound.ok) return { ok: false as const, code: 'invalid_input' };
    const result = await changeDecision(
      {
        organizationId: bound.data.organizationId,
        tryoutId: bound.data.tryoutId,
        divisionId: bound.data.divisionId,
        rosterVersionId: bound.data.rosterVersionId,
        expectedVersion: bound.data.expectedVersion,
        confirmation: 'CONFIRM DECISIONS',
        changes: bound.data.changes,
      },
      scoped.authorization,
    );
    if (!result.ok)
      return {
        ok: false as const,
        code: result.error.code,
        currentVersion: result.error.currentVersion,
      };
    return { ok: true as const, version: result.value.version };
  }

  async function finalizeAction(input: unknown) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const bound = bindFinalizeRosterActionInput(input, {
      organizationId: scoped.organization.id,
      tryoutId,
      divisionId: selectedDivisionId,
    });
    if (!bound.ok) return { ok: false as const, code: 'invalid_input' };
    const result = await finalizeRoster(
      {
        organizationId: bound.data.organizationId,
        tryoutId: bound.data.tryoutId,
        divisionId: bound.data.divisionId,
        rosterVersionId: bound.data.rosterVersionId,
        expectedVersion: bound.data.expectedVersion,
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
    return { ok: true as const, version: result.value.version };
  }

  async function reviseAction(input: unknown) {
    'use server';
    const scoped = await requireOrganizationRouteContext(organizationSlug);
    const bound = bindReviseRosterActionInput(input, {
      organizationId: scoped.organization.id,
      tryoutId,
      divisionId: selectedDivisionId,
    });
    if (!bound.ok) return { ok: false as const, code: 'invalid_input' };
    const result = await reviseRoster(
      {
        organizationId: bound.data.organizationId,
        tryoutId: bound.data.tryoutId,
        divisionId: bound.data.divisionId,
        rosterVersionId: bound.data.rosterVersionId,
        expectedVersion: bound.data.expectedVersion,
        reason: bound.data.reason,
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
    const workspaceResult = await loadRosterWorkspace(
      { organizationId, tryoutId, divisionId, rosterVersionId: roster.id },
      {
        rosters: new SupabaseRosterWorkspaceGateway(current.client),
        rankings: new SupabaseRankingGateway(current.client),
      },
    );
    if (workspaceResult.outcome !== 'ok') {
      content = (
        <ErrorState
          description={
            workspaceResult.outcome === 'forbidden'
              ? 'Your current role is not authorized to read this exact roster snapshot.'
              : 'The authorized roster snapshot could not be loaded. Refresh and try again.'
          }
          title="Roster workspace unavailable"
        />
      );
    } else {
      const rankingByRegistration = new Map(
        workspaceResult.rankingRows.map((row) => [row.registrationId, row]),
      );
      const { members, ...authoritative } = workspaceResult.snapshot;
      const athletes = members.map((member) => {
        const ranking = rankingByRegistration.get(member.registrationId);
        const rankingEvidence = rankingEvidenceForRosterMember(
          workspaceResult.evidenceAvailability,
          ranking,
        );
        return {
          registrationId: member.registrationId,
          displayName: member.displayName,
          tryoutNumber: member.tryoutNumber,
          positionId: member.positionId,
          positionName: member.positionName,
          rankingEvidence,
          decision: member.decision,
          teamId: member.teamId,
        };
      });
      const snapshot: RosterWorkspaceSnapshot = {
        ...authoritative,
        evidenceAvailability: workspaceResult.evidenceAvailability,
        athletes,
      };
      content = (
        <RosterBuilder
          canEdit={canEdit}
          initial={snapshot}
          key={snapshot.rosterVersionId}
          onChangeDecisions={changeAction}
          onFinalize={finalizeAction}
          onMove={moveAction}
          onRevise={reviseAction}
        />
      );
    }
  }

  return (
    <section aria-labelledby="roster-heading" className="min-w-0">
      <TryoutJourneyNavigation
        nextAction={{
          label: 'Review communication',
          href: `/app/${organizationSlug}/tryouts/${tryoutId}/messages`,
        }}
        overviewHref={`/app/${organizationSlug}/tryouts/${tryoutId}/overview`}
      />
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
              prefetch={false}
            >
              {candidate.name}
            </Link>
          ))}
        </nav>
      ) : null}
      {roster ? (
        <RosterExportLink
          authorized={canExport}
          rosterState={roster.state}
          href={`/app/${organizationSlug}/tryouts/${tryoutId}/rosters/${roster.id}/export`}
        />
      ) : null}
      {content}
    </section>
  );
}
