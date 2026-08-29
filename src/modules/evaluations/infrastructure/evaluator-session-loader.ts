import 'server-only';

import { listAssignedAthletes } from '../../staffing/application/list-assigned-athletes';
import type { AssignedAthleteSummary } from '../../staffing/domain/assignment';
import { SupabaseAssignedAthleteGateway } from '../../staffing/infrastructure/supabase-assigned-athlete-gateway';
import { requireOrganizationRouteContext } from '../../organizations/application/organization-route-context';

export type EvaluatorSessionSummary = {
  id: string;
  tryoutId: string;
  divisionId: string;
  name: string;
};

export type EvaluatorRubricCategory = {
  id: string;
  name: string;
  description: string | null;
  guidance: string | null;
  scaleMin: 1;
  scaleMax: 5 | 10;
  required: true;
};

export type OwnEvaluationSummary = {
  id: string;
  registrationId: string;
  rubricVersionId: string;
  state: 'draft' | 'completed' | 'locked' | 'reopened';
  version: number;
};

export type EvaluatorSessionData = {
  current: Awaited<ReturnType<typeof requireOrganizationRouteContext>>;
  session: EvaluatorSessionSummary;
  athletes: AssignedAthleteSummary[];
  rubricVersionId: string;
  categories: EvaluatorRubricCategory[];
  noteTags: { id: string; label: string }[];
  evaluations: OwnEvaluationSummary[];
};

export type EvaluatorSessionLoadResult =
  { outcome: 'ready'; value: EvaluatorSessionData } | { outcome: 'forbidden' | 'unexpected' };

function isEvaluationState(value: string): value is OwnEvaluationSummary['state'] {
  return value === 'draft' || value === 'completed' || value === 'locked' || value === 'reopened';
}

export async function loadEvaluatorSession(
  organizationSlug: string,
  sessionId: string,
): Promise<EvaluatorSessionLoadResult> {
  const current = await requireOrganizationRouteContext(organizationSlug);
  const sessionResult = await current.client
    .from('tryout_sessions')
    .select('id,tryout_id,division_id,name')
    .eq('organization_id', current.organization.id)
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionResult.error) return { outcome: 'unexpected' };
  if (!sessionResult.data) return { outcome: 'forbidden' };

  const assigned = await listAssignedAthletes(
    { organizationId: current.organization.id, tryoutId: sessionResult.data.tryout_id },
    current.authorization,
    new SupabaseAssignedAthleteGateway(current.client),
  );
  if (!assigned.ok) {
    return {
      outcome:
        assigned.error.code === 'forbidden' ? ('forbidden' as const) : ('unexpected' as const),
    };
  }
  const athletes = assigned.value.filter((athlete) => athlete.sessionId === sessionId);

  const [binding, tags, evaluations] = await Promise.all([
    current.client
      .from('session_rubrics')
      .select('rubric_version_id')
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', sessionResult.data.tryout_id)
      .eq('session_id', sessionId)
      .maybeSingle(),
    current.client
      .from('organization_evaluation_note_tags')
      .select('id,label')
      .eq('organization_id', current.organization.id)
      .eq('active', true)
      .order('label'),
    current.client
      .from('evaluations')
      .select('id,tryout_registration_id,rubric_version_id,state,version')
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', sessionResult.data.tryout_id)
      .eq('tryout_session_id', sessionId)
      .eq('evaluator_user_id', current.userId),
  ]);
  if (binding.error || tags.error || evaluations.error || !binding.data) {
    return { outcome: 'unexpected' };
  }
  const categoryResult = await current.client
    .from('rubric_categories')
    .select('id,name,description,guidance,scale_min,scale_max')
    .eq('organization_id', current.organization.id)
    .eq('tryout_id', sessionResult.data.tryout_id)
    .eq('rubric_version_id', binding.data.rubric_version_id)
    .order('sort_order');
  if (categoryResult.error) return { outcome: 'unexpected' };
  const categories: EvaluatorRubricCategory[] = [];
  for (const category of categoryResult.data) {
    if (category.scale_min !== 1 || (category.scale_max !== 5 && category.scale_max !== 10)) {
      return { outcome: 'unexpected' };
    }
    categories.push({
      id: category.id,
      name: category.name,
      description: category.description,
      guidance: category.guidance,
      scaleMin: 1,
      scaleMax: category.scale_max,
      required: true,
    });
  }
  const ownEvaluations: OwnEvaluationSummary[] = [];
  for (const evaluation of evaluations.data) {
    if (!isEvaluationState(evaluation.state)) return { outcome: 'unexpected' };
    ownEvaluations.push({
      id: evaluation.id,
      registrationId: evaluation.tryout_registration_id,
      rubricVersionId: evaluation.rubric_version_id,
      state: evaluation.state,
      version: evaluation.version,
    });
  }
  return {
    outcome: 'ready',
    value: {
      current,
      session: {
        id: sessionResult.data.id,
        tryoutId: sessionResult.data.tryout_id,
        divisionId: sessionResult.data.division_id,
        name: sessionResult.data.name,
      },
      athletes,
      rubricVersionId: binding.data.rubric_version_id,
      categories,
      noteTags: tags.data,
      evaluations: ownEvaluations,
    },
  };
}

export async function loadOwnEvaluationDraft(data: EvaluatorSessionData, registrationId: string) {
  const athlete = data.athletes.find((candidate) => candidate.registrationId === registrationId);
  if (!athlete) return { outcome: 'forbidden' as const };
  const summary = data.evaluations.find(
    (evaluation) => evaluation.registrationId === registrationId,
  );
  if (!summary) {
    return {
      outcome: 'ready' as const,
      athlete,
      draft: {
        evaluationId: null,
        version: 0,
        state: 'draft' as const,
        scores: [],
        note: '',
        noteTagIds: [],
        flags: [],
      },
    };
  }
  const [scores, note, selectedTags, flags] = await Promise.all([
    data.current.client
      .from('evaluation_scores')
      .select('rubric_category_id,value')
      .eq('organization_id', data.current.organization.id)
      .eq('evaluation_id', summary.id),
    data.current.client
      .from('evaluation_notes')
      .select('note')
      .eq('organization_id', data.current.organization.id)
      .eq('evaluation_id', summary.id)
      .maybeSingle(),
    data.current.client
      .from('evaluation_note_tags')
      .select('note_tag_id')
      .eq('organization_id', data.current.organization.id)
      .eq('evaluation_id', summary.id),
    data.current.client
      .from('athlete_flags')
      .select('flag_type')
      .eq('organization_id', data.current.organization.id)
      .eq('evaluation_id', summary.id)
      .eq('creator_kind', 'evaluator')
      .is('revoked_at', null),
  ]);
  if (scores.error || note.error || selectedTags.error || flags.error) {
    return { outcome: 'unexpected' as const };
  }
  return {
    outcome: 'ready' as const,
    athlete,
    draft: {
      evaluationId: summary.id,
      version: summary.version,
      state: summary.state,
      scores: scores.data.map((score) => ({
        categoryId: score.rubric_category_id,
        value: score.value,
      })),
      note: note.data?.note ?? '',
      noteTagIds: selectedTags.data.map((tag) => tag.note_tag_id),
      flags: flags.data.map((flag) => flag.flag_type),
    },
  };
}
