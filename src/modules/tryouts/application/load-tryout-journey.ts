import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId } from '../../../lib/ids';
import type {
  AuthorizationContext,
  Capability,
} from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { SupabaseLiveDashboardGateway } from './get-live-dashboard';
import { tryoutSetupSteps } from './save-tryout-setup-step';

export type JourneyStageId = 'prepare' | 'participants' | 'run' | 'decide' | 'complete';
export type JourneyStageStatus =
  'not-started' | 'in-progress' | 'ready' | 'complete' | 'unavailable';

export type JourneyAction = {
  label: string;
  href: string;
};

export type JourneyStage = {
  id: JourneyStageId;
  title: string;
  purpose: string;
  status: JourneyStageStatus;
  supportingText: string;
  primaryAction: JourneyAction;
  secondaryActions: JourneyAction[];
  blocker?: string;
};

export type TryoutJourney = {
  tryout: {
    id: string;
    name: string;
    slug: string;
    status: 'draft' | 'published' | 'finalized';
  };
  stages: [JourneyStage, JourneyStage, JourneyStage, JourneyStage, JourneyStage];
  nextStage: JourneyStageId;
  primaryAction: JourneyAction;
};

export type TryoutJourneyScope = {
  organizationId: OrganizationId;
  tryoutId: string;
  organizationSlug: string;
  authorization: AuthorizationContext;
};

export class TryoutJourneyLoadError extends Error {
  constructor(public readonly code: 'invalid_scope' | 'forbidden' | 'not_found' | 'unavailable') {
    super(`Tryout journey ${code}`);
    this.name = 'TryoutJourneyLoadError';
  }
}

const scopeSchema = z
  .object({
    organizationId: z.uuid(),
    tryoutId: z.uuid(),
    organizationSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  })
  .strict();
const tryoutSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(160),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    status: z.enum(['draft', 'published', 'finalized']),
  })
  .strict();
const progressSchema = z
  .object({
    completed_steps: z
      .array(z.enum(tryoutSetupSteps))
      .max(tryoutSetupSteps.length)
      .refine((steps) => new Set(steps).size === steps.length),
    last_step: z.enum(tryoutSetupSteps),
  })
  .strict();
const divisionSchema = z.object({ id: z.uuid() }).strict();
const rosterRevisionSchema = z
  .object({
    id: z.uuid(),
    division_id: z.uuid(),
    state: z.enum(['draft', 'finalized']),
    revision_number: z.number().int().positive().max(1_000_000_000),
  })
  .strict();
const evaluatorAssignmentSchema = z
  .object({
    assignment_id: z.uuid(),
    evaluator_user_id: z.uuid(),
    evaluator_name: z.string().min(1),
    scope_kind: z.enum(['tryout', 'division', 'session', 'group']),
    division_id: z.uuid().nullable(),
    session_id: z.uuid().nullable(),
    group_id: z.uuid().nullable(),
    scope_label: z.string().min(1),
    expires_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
const communicationStates = [
  'queued',
  'delivery_uncertain',
  'submitted',
  'delivery_delayed',
  'delivered',
  'failed',
  'bounced',
  'cancelled',
  'suppressed',
  'complained',
] as const;
const communicationStateSchema = z
  .object({
    source_roster_version_id: z.uuid(),
    state: z.enum(communicationStates),
  })
  .strict();
const maximumJourneyDivisions = 100;
const maximumJourneyRosterVersions = 500;
const maximumJourneyCommunicationRows = 500;
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

type QueryResult = { data: unknown; error: unknown; count?: number | null };
type RosterRevision = z.infer<typeof rosterRevisionSchema>;
type RosterEvidence = {
  divisionIds: string[];
  latestByDivision: Map<string, RosterRevision>;
};

async function loadOperationalCounts(client: SupabaseClient<Database>, scope: TryoutJourneyScope) {
  const result = await new SupabaseLiveDashboardGateway(client).load({
    organizationId: scope.organizationId,
    tryoutId: scope.tryoutId,
  });
  if (result.outcome !== 'ok') throw new TryoutJourneyLoadError('unavailable');
  return result.dashboard;
}

function authorize(scope: TryoutJourneyScope, capability: Capability): scope is TryoutJourneyScope {
  return requireCapability(scope.authorization, capability, {
    organizationId: scope.organizationId,
    tryoutId: scope.tryoutId,
  }).ok;
}

function parseOne<T>(result: QueryResult, schema: z.ZodType<T>): T | null {
  if (result.error) throw new TryoutJourneyLoadError('unavailable');
  const parsed = z.array(schema).max(1).safeParse(result.data);
  if (!parsed.success) throw new TryoutJourneyLoadError('unavailable');
  return parsed.data[0] ?? null;
}

function parseCount(result: QueryResult): number {
  if (result.error) throw new TryoutJourneyLoadError('unavailable');
  const parsed = countSchema.safeParse(result.count);
  if (!parsed.success) throw new TryoutJourneyLoadError('unavailable');
  return parsed.data;
}

function parseExactRows<T>(result: QueryResult, schema: z.ZodType<T>, maximumRows: number): T[] {
  if (result.error) throw new TryoutJourneyLoadError('unavailable');
  const rows = z.array(schema).max(maximumRows).safeParse(result.data);
  const count = countSchema.safeParse(result.count);
  if (!rows.success || !count.success || count.data !== rows.data.length)
    throw new TryoutJourneyLoadError('unavailable');
  return rows.data;
}

async function loadRosterEvidence(
  client: SupabaseClient<Database>,
  scope: TryoutJourneyScope,
): Promise<RosterEvidence> {
  const [divisionsResult, rostersResult] = await Promise.all([
    client
      .from('tryout_divisions')
      .select('id', { count: 'exact' })
      .eq('organization_id', scope.organizationId)
      .eq('tryout_id', scope.tryoutId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .limit(maximumJourneyDivisions),
    client
      .from('roster_versions')
      .select('id,division_id,state,revision_number', { count: 'exact' })
      .eq('organization_id', scope.organizationId)
      .eq('tryout_id', scope.tryoutId)
      .order('division_id', { ascending: true })
      .order('revision_number', { ascending: false })
      .order('id', { ascending: true })
      .limit(maximumJourneyRosterVersions),
  ]);
  const divisions = parseExactRows(divisionsResult, divisionSchema, maximumJourneyDivisions);
  const rosterVersions = parseExactRows(
    rostersResult,
    rosterRevisionSchema,
    maximumJourneyRosterVersions,
  );
  const divisionIds = divisions.map((division) => division.id);
  const divisionSet = new Set(divisionIds);
  if (divisionSet.size !== divisionIds.length) throw new TryoutJourneyLoadError('unavailable');

  const latestByDivision = new Map<string, RosterRevision>();
  const seenRevisions = new Set<string>();
  for (const roster of rosterVersions) {
    if (!divisionSet.has(roster.division_id)) throw new TryoutJourneyLoadError('unavailable');
    const revisionKey = `${roster.division_id}:${roster.revision_number}`;
    if (seenRevisions.has(revisionKey)) throw new TryoutJourneyLoadError('unavailable');
    seenRevisions.add(revisionKey);
    const current = latestByDivision.get(roster.division_id);
    if (!current || roster.revision_number > current.revision_number) {
      latestByDivision.set(roster.division_id, roster);
    }
  }
  return { divisionIds, latestByDivision };
}

function unavailableStage(
  stage: Pick<JourneyStage, 'id' | 'title' | 'purpose' | 'primaryAction' | 'secondaryActions'>,
  supportingText: string,
  blocker = 'This stage could not be verified. Refresh before relying on its status.',
): JourneyStage {
  return { ...stage, status: 'unavailable', supportingText, blocker };
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

async function loadPrepareStage(
  client: SupabaseClient<Database>,
  scope: TryoutJourneyScope,
  status: TryoutJourney['tryout']['status'],
  baseHref: string,
): Promise<JourneyStage> {
  const base = {
    id: 'prepare' as const,
    title: 'Prepare',
    purpose: 'Configure and publish the tryout.',
    primaryAction: { label: 'Continue setup', href: `${baseHref}/setup/basics` },
    secondaryActions: [{ label: 'Review setup', href: `${baseHref}/setup/review` }],
  };
  if (status !== 'draft') {
    return {
      ...base,
      status: 'complete',
      supportingText: 'Tryout published',
      primaryAction: { label: 'Review setup', href: `${baseHref}/setup/review` },
      secondaryActions: [],
    };
  }
  if (!authorize(scope, 'tryout:write')) {
    return unavailableStage(
      base,
      'Setup access unavailable',
      'Your current role cannot update tryout setup.',
    );
  }
  try {
    const result = await client
      .from('tryout_setup_progress')
      .select('completed_steps,last_step')
      .eq('organization_id', scope.organizationId)
      .eq('tryout_id', scope.tryoutId)
      .limit(1);
    const progress = parseOne(result, progressSchema);
    const completed = progress?.completed_steps ?? [];
    const nextStep = tryoutSetupSteps.find((step) => !completed.includes(step)) ?? 'publish';
    return {
      ...base,
      status: completed.length === tryoutSetupSteps.length ? 'ready' : 'in-progress',
      supportingText: `${completed.length} of ${tryoutSetupSteps.length} setup steps complete`,
      primaryAction: { label: 'Continue setup', href: `${baseHref}/setup/${nextStep}` },
    };
  } catch {
    return unavailableStage(base, 'Setup progress unavailable');
  }
}

async function loadParticipantsStage(
  client: SupabaseClient<Database>,
  scope: TryoutJourneyScope,
  status: TryoutJourney['tryout']['status'],
  baseHref: string,
): Promise<JourneyStage> {
  const base = {
    id: 'participants' as const,
    title: 'Participants',
    purpose: 'Bring athletes into the tryout.',
    primaryAction: { label: 'Manage participants', href: `${baseHref}/registration` },
    secondaryActions: [
      { label: 'Share registration link', href: `${baseHref}/overview#registration-share` },
      { label: 'Import CSV', href: `/app/${scope.organizationSlug}/athletes/import` },
    ],
  };
  if (status === 'draft') {
    return {
      ...base,
      status: 'not-started',
      supportingText: 'Participant intake opens after publishing',
      primaryAction: { label: 'Continue setup', href: `${baseHref}/setup/basics` },
      blocker: 'Publish the tryout before adding participants.',
    };
  }
  if (!authorize(scope, 'athlete:read')) {
    return unavailableStage(
      base,
      'Participant count unavailable',
      'Your current role cannot read participant intake.',
    );
  }
  try {
    const result = await client
      .from('tryout_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', scope.organizationId)
      .eq('tryout_id', scope.tryoutId);
    const count = parseCount(result);
    return {
      ...base,
      status: count === 0 ? 'not-started' : 'ready',
      supportingText:
        count === 0
          ? 'No participants registered yet'
          : `${plural(count, 'participant')} registered`,
      primaryAction:
        count === 0
          ? {
              label: 'Add first participant',
              href: `${baseHref}/registration#add-participant`,
            }
          : { label: 'Manage participants', href: `${baseHref}/registration` },
    };
  } catch {
    return unavailableStage(base, 'Participant count unavailable');
  }
}

async function loadRunStage(
  client: SupabaseClient<Database>,
  scope: TryoutJourneyScope,
  status: TryoutJourney['tryout']['status'],
  baseHref: string,
): Promise<JourneyStage> {
  const base = {
    id: 'run' as const,
    title: 'Run tryout',
    purpose: 'Check in athletes and collect evaluations.',
    primaryAction: { label: 'Open check-in', href: `${baseHref}/check-in` },
    secondaryActions: [
      { label: 'Review sessions', href: `${baseHref}/sessions` },
      { label: 'Open live dashboard', href: `${baseHref}/live` },
    ],
  };
  if (status === 'draft') {
    return {
      ...base,
      status: 'not-started',
      supportingText: 'Operations open after publishing',
      blocker: 'Publish the tryout before running sessions.',
    };
  }
  if (
    !authorize(scope, 'athlete:read') ||
    !authorize(scope, 'checkin:read') ||
    !authorize(scope, 'evaluation:read') ||
    !authorize(scope, 'tryout:write')
  ) {
    return unavailableStage(
      base,
      'Operational counts unavailable',
      'Your current role cannot read all operational evidence.',
    );
  }
  try {
    const [participantsResult, sessionsResult, operations, evaluatorAssignmentsResult] =
      await Promise.all([
        client
          .from('tryout_registrations')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', scope.organizationId)
          .eq('tryout_id', scope.tryoutId),
        client
          .from('tryout_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', scope.organizationId)
          .eq('tryout_id', scope.tryoutId),
        loadOperationalCounts(client, scope),
        client
          .rpc('list_manageable_evaluator_assignments', {
            p_organization_id: scope.organizationId,
            p_tryout_id: scope.tryoutId,
          })
          .limit(1),
      ]);
    const participantCount = parseCount(participantsResult);
    const sessionCount = parseCount(sessionsResult);
    const evaluatorAssignment = parseOne(evaluatorAssignmentsResult, evaluatorAssignmentSchema);
    const checkinCount = operations.checkedIn;
    const evaluationCount = operations.completedEvaluations;
    const expectedEvaluationCount = operations.expectedEvaluations;
    const evaluatorText = operations.activeEvaluators
      ? plural(operations.activeEvaluators, 'active evaluator')
      : evaluatorAssignment
        ? 'Evaluator assigned'
        : 'No evaluator assigned';
    const supportingText = `${plural(sessionCount, 'session')} · ${evaluatorText} · ${plural(checkinCount, 'check-in')} · ${evaluationCount} of ${expectedEvaluationCount} evaluations complete`;
    if (participantCount === 0) {
      return {
        ...base,
        status: 'not-started',
        supportingText,
        primaryAction: {
          label: 'Add first participant',
          href: `${baseHref}/registration#add-participant`,
        },
        blocker: 'Add a participant before opening tryout operations.',
      };
    }
    if (sessionCount === 0) {
      return {
        ...base,
        status: 'in-progress',
        supportingText,
        primaryAction: { label: 'Review sessions', href: `${baseHref}/sessions` },
        blocker: 'Configure at least one session before check-in.',
      };
    }
    if (!evaluatorAssignment) {
      return {
        ...base,
        status: 'in-progress',
        supportingText,
        primaryAction: { label: 'Review staff', href: `${baseHref}/staff` },
        blocker: 'Assign at least one evaluator before running sessions.',
      };
    }
    if (expectedEvaluationCount > 0 && evaluationCount >= expectedEvaluationCount) {
      return {
        ...base,
        status: 'complete',
        supportingText,
        primaryAction: { label: 'Open live dashboard', href: `${baseHref}/live` },
        secondaryActions: [
          { label: 'Open check-in', href: `${baseHref}/check-in` },
          { label: 'Review sessions', href: `${baseHref}/sessions` },
        ],
      };
    }
    if (evaluationCount === 0) return { ...base, status: 'ready', supportingText };
    return {
      ...base,
      status: 'in-progress',
      supportingText,
      primaryAction: { label: 'Open live dashboard', href: `${baseHref}/live` },
      secondaryActions: [
        { label: 'Open check-in', href: `${baseHref}/check-in` },
        { label: 'Review sessions', href: `${baseHref}/sessions` },
      ],
    };
  } catch {
    return unavailableStage(base, 'Operational counts unavailable');
  }
}

async function loadDecideStage(
  client: SupabaseClient<Database>,
  scope: TryoutJourneyScope,
  status: TryoutJourney['tryout']['status'],
  baseHref: string,
  rosterEvidence: () => Promise<RosterEvidence>,
): Promise<JourneyStage> {
  const base = {
    id: 'decide' as const,
    title: 'Make decisions',
    purpose: 'Review evidence and build rosters.',
    primaryAction: { label: 'Review rankings', href: `${baseHref}/rankings` },
    secondaryActions: [
      { label: 'Compare athletes', href: `${baseHref}/compare` },
      { label: 'Build rosters', href: `${baseHref}/rosters` },
    ],
  };
  if (status === 'draft') {
    return {
      ...base,
      status: 'not-started',
      supportingText: 'Decision evidence is not available yet',
      blocker: 'Publish and run the tryout before making decisions.',
    };
  }
  if (
    !authorize(scope, 'evaluation:read') ||
    !authorize(scope, 'ranking:read') ||
    !authorize(scope, 'roster:read')
  ) {
    return unavailableStage(
      base,
      'Decision evidence unavailable',
      'Your current role cannot read all decision evidence.',
    );
  }
  try {
    const [operations, rosters] = await Promise.all([
      loadOperationalCounts(client, scope),
      rosterEvidence(),
    ]);
    const evaluationCount = operations.completedEvaluations;
    const requiredDivisionCount = rosters.divisionIds.length;
    if (requiredDivisionCount === 0) {
      return unavailableStage(base, 'Decision division scope unavailable');
    }
    const latestRosters = rosters.divisionIds.flatMap((divisionId) => {
      const roster = rosters.latestByDivision.get(divisionId);
      return roster ? [roster] : [];
    });
    const finalizedCount = latestRosters.filter((roster) => roster.state === 'finalized').length;
    const draftCount = latestRosters.filter((roster) => roster.state === 'draft').length;
    const coverageText = `${finalizedCount} of ${requiredDivisionCount} divisions finalized`;
    if (finalizedCount === requiredDivisionCount) {
      return {
        ...base,
        status: 'complete',
        supportingText: `${plural(evaluationCount, 'completed evaluation')} · ${coverageText}`,
        primaryAction: { label: 'Review roster', href: `${baseHref}/rosters` },
      };
    }
    if (evaluationCount === 0) {
      return {
        ...base,
        status: 'not-started',
        supportingText: 'No completed evaluations yet',
        blocker: 'Complete at least one evaluation before making decisions.',
      };
    }
    if (latestRosters.length > 0) {
      return {
        ...base,
        status: 'in-progress',
        supportingText: `${plural(evaluationCount, 'completed evaluation')} · ${coverageText}${draftCount > 0 ? ` · ${plural(draftCount, 'roster draft')}` : ''}`,
        primaryAction: { label: 'Continue roster', href: `${baseHref}/rosters` },
      };
    }
    return {
      ...base,
      status: 'ready',
      supportingText: `${plural(evaluationCount, 'completed evaluation')} ready for review · ${coverageText}`,
    };
  } catch {
    return unavailableStage(base, 'Decision evidence unavailable');
  }
}

async function loadCompleteStage(
  client: SupabaseClient<Database>,
  scope: TryoutJourneyScope,
  status: TryoutJourney['tryout']['status'],
  baseHref: string,
  rosterEvidence: () => Promise<RosterEvidence>,
): Promise<JourneyStage> {
  const base = {
    id: 'complete' as const,
    title: 'Complete',
    purpose: 'Communicate and report from immutable roster evidence.',
    primaryAction: { label: 'Build rosters', href: `${baseHref}/rosters` },
    secondaryActions: [
      { label: 'Review reports', href: `${baseHref}/reports` },
      ...(authorize(scope, 'audit:read')
        ? [
            {
              label: 'Review audit history',
              href: `/app/${scope.organizationSlug}/organization/audit`,
            },
          ]
        : []),
    ],
  };
  if (status === 'draft') {
    return {
      ...base,
      status: 'not-started',
      supportingText: 'No finalized roster yet',
      blocker: 'Publish and run the tryout before finalizing a roster.',
    };
  }
  if (!authorize(scope, 'roster:read')) {
    return unavailableStage(
      base,
      'Final roster status unavailable',
      'Your current role cannot read finalized rosters.',
    );
  }
  try {
    const rosters = await rosterEvidence();
    const requiredDivisionCount = rosters.divisionIds.length;
    if (requiredDivisionCount === 0) {
      return unavailableStage(base, 'Final roster division scope unavailable');
    }
    const finalizedRosters = rosters.divisionIds.flatMap((divisionId) => {
      const roster = rosters.latestByDivision.get(divisionId);
      return roster?.state === 'finalized' ? [roster] : [];
    });
    if (finalizedRosters.length === 0) {
      return {
        ...base,
        status: 'not-started',
        supportingText: 'No finalized roster yet',
        blocker: 'Finalize a roster before communicating decisions.',
      };
    }
    if (finalizedRosters.length < requiredDivisionCount) {
      return {
        ...base,
        status: 'in-progress',
        supportingText: `${finalizedRosters.length} of ${requiredDivisionCount} divisions finalized`,
        blocker: 'Finalize every division roster before communicating decisions.',
      };
    }
    const readyText =
      finalizedRosters.length === 1
        ? 'Finalized roster ready'
        : `${finalizedRosters.length} finalized rosters ready`;
    if (!authorize(scope, 'roster:write')) {
      return {
        ...base,
        status: 'ready',
        supportingText: readyText,
        primaryAction: { label: 'Review reports', href: `${baseHref}/reports` },
        blocker: 'Your current role cannot send roster decision messages.',
      };
    }
    let messages: Array<z.infer<typeof communicationStateSchema>>;
    try {
      const finalizedRosterIds = finalizedRosters.map((roster) => roster.id);
      const messagesResult = await client
        .from('communication_messages')
        .select('source_roster_version_id,state', { count: 'exact' })
        .eq('organization_id', scope.organizationId)
        .eq('source_kind', 'roster_decision')
        .in('source_roster_version_id', finalizedRosterIds)
        .order('source_roster_version_id', { ascending: true })
        .order('id', { ascending: true })
        .limit(maximumJourneyCommunicationRows);
      messages = parseExactRows(
        messagesResult,
        communicationStateSchema,
        maximumJourneyCommunicationRows,
      );
      const finalizedRosterIdSet = new Set(finalizedRosterIds);
      if (messages.some((message) => !finalizedRosterIdSet.has(message.source_roster_version_id))) {
        throw new TryoutJourneyLoadError('unavailable');
      }
    } catch {
      return unavailableStage(
        {
          ...base,
          primaryAction: { label: 'Review communication', href: `${baseHref}/messages` },
        },
        `${readyText} · Communication status unavailable`,
      );
    }
    if (messages.length === 0)
      return {
        ...base,
        status: 'ready',
        supportingText: `${readyText} · No decision messages queued`,
        primaryAction: { label: 'Review communication', href: `${baseHref}/messages` },
      };
    const stateCounts = new Map(communicationStates.map((state) => [state, 0]));
    const rosterIdsWithEvidence = new Set<string>();
    for (const message of messages) {
      stateCounts.set(message.state, (stateCounts.get(message.state) ?? 0) + 1);
      rosterIdsWithEvidence.add(message.source_roster_version_id);
    }
    const stateText = communicationStates
      .flatMap((state) => {
        const count = stateCounts.get(state) ?? 0;
        return count === 0 ? [] : [`${count} ${state.replaceAll('_', ' ')}`];
      })
      .join(' · ');
    const allRostersHaveEvidence = rosterIdsWithEvidence.size === finalizedRosters.length;
    const allDelivered = allRostersHaveEvidence && stateCounts.get('delivered') === messages.length;
    const evidenceText = allRostersHaveEvidence
      ? ''
      : ` · Communication evidence for ${rosterIdsWithEvidence.size} of ${finalizedRosters.length} rosters`;
    return {
      ...base,
      status: allDelivered ? 'complete' : 'in-progress',
      supportingText: `${readyText} · ${stateText}${evidenceText}`,
      primaryAction: allDelivered
        ? { label: 'Review reports', href: `${baseHref}/reports` }
        : { label: 'Review communication', href: `${baseHref}/messages` },
    };
  } catch {
    return unavailableStage(base, 'Completion status unavailable');
  }
}

function recommendedStage(
  status: TryoutJourney['tryout']['status'],
  stages: TryoutJourney['stages'],
): JourneyStage {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const prepare = byId.get('prepare')!;
  const participants = byId.get('participants')!;
  const run = byId.get('run')!;
  const decide = byId.get('decide')!;
  const complete = byId.get('complete')!;
  if (status === 'draft') return prepare;
  if (participants.status === 'not-started' || participants.status === 'unavailable')
    return participants;
  if (run.status !== 'complete') return run;
  if (decide.status === 'ready' || decide.status === 'in-progress') return decide;
  return decide.status === 'complete' ? complete : decide;
}

export async function loadTryoutJourney(
  client: SupabaseClient<Database>,
  scope: TryoutJourneyScope,
): Promise<TryoutJourney> {
  const parsedScope = scopeSchema.safeParse({
    organizationId: scope.organizationId,
    tryoutId: scope.tryoutId,
    organizationSlug: scope.organizationSlug,
  });
  if (!parsedScope.success) throw new TryoutJourneyLoadError('invalid_scope');
  if (!authorize(scope, 'tryout:read')) throw new TryoutJourneyLoadError('forbidden');

  const tryoutResult = await client
    .from('tryouts')
    .select('id,name,slug,status')
    .eq('organization_id', scope.organizationId)
    .eq('id', scope.tryoutId)
    .limit(1);
  let tryout;
  try {
    tryout = parseOne(tryoutResult, tryoutSchema);
  } catch {
    throw new TryoutJourneyLoadError('unavailable');
  }
  if (!tryout) throw new TryoutJourneyLoadError('not_found');
  const baseHref = `/app/${scope.organizationSlug}/tryouts/${scope.tryoutId}`;
  let rosterEvidencePromise: Promise<RosterEvidence> | undefined;
  const rosterEvidence = () => {
    rosterEvidencePromise ??= loadRosterEvidence(client, scope);
    return rosterEvidencePromise;
  };
  const stages = (await Promise.all([
    loadPrepareStage(client, scope, tryout.status, baseHref),
    loadParticipantsStage(client, scope, tryout.status, baseHref),
    loadRunStage(client, scope, tryout.status, baseHref),
    loadDecideStage(client, scope, tryout.status, baseHref, rosterEvidence),
    loadCompleteStage(client, scope, tryout.status, baseHref, rosterEvidence),
  ])) as TryoutJourney['stages'];
  const next = recommendedStage(tryout.status, stages);
  return {
    tryout,
    stages,
    nextStage: next.id,
    primaryAction: next.primaryAction,
  };
}
