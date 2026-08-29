import { z } from 'zod';

import { completeEvaluationRecord } from '@/modules/evaluations/application/complete-evaluation';
import { saveEvaluationDraft } from '@/modules/evaluations/application/save-evaluation-draft';
import {
  loadEvaluatorSession,
  loadOwnEvaluationDraft,
} from '@/modules/evaluations/infrastructure/evaluator-session-loader';
import { SupabaseEvaluationGateway } from '@/modules/evaluations/infrastructure/supabase-evaluation-gateway';
import { AthletePager } from '@/modules/evaluations/ui/athlete-pager';
import { EvaluationForm } from '@/modules/evaluations/ui/evaluation-form';
import { EvaluationRouteMessage } from '@/modules/evaluations/ui/session-state';

const saveSchema = z.strictObject({
  scores: z.array(z.strictObject({ categoryId: z.uuid(), value: z.number().int() })).max(100),
  note: z.string().trim().min(1).max(4000).optional(),
  noteTagIds: z.array(z.uuid()).max(50),
  flags: z.array(z.enum(['needs_another_look', 'injury_concern', 'eligibility_review'])).max(3),
  expectedVersion: z.number().int().min(0),
});
const completeSchema = z.strictObject({
  evaluationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});

export default async function AthleteEvaluationPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; sessionId: string; registrationId: string }>;
}) {
  const { organizationSlug, sessionId, registrationId } = await params;
  const loaded = await loadEvaluatorSession(organizationSlug, sessionId);
  if (loaded.outcome !== 'ready') return <EvaluationRouteMessage outcome={loaded.outcome} />;
  const ownDraft = await loadOwnEvaluationDraft(loaded.value, registrationId);
  if (ownDraft.outcome !== 'ready') {
    return (
      <EvaluationRouteMessage
        outcome={ownDraft.outcome === 'forbidden' ? 'forbidden' : 'unexpected'}
      />
    );
  }
  const athleteIndex = loaded.value.athletes.findIndex(
    (athlete) => athlete.registrationId === registrationId,
  );
  const basePath = `/app/${organizationSlug}/evaluate/session/${sessionId}`;
  const previous = loaded.value.athletes[athleteIndex - 1];
  const next = loaded.value.athletes[athleteIndex + 1];

  async function onSave(input: unknown) {
    'use server';
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'invalid_input' as const };
    const scoped = await loadEvaluatorSession(organizationSlug, sessionId);
    if (scoped.outcome !== 'ready')
      return { outcome: scoped.outcome as 'forbidden' | 'unexpected' };
    const athlete = scoped.value.athletes.find(
      (candidate) => candidate.registrationId === registrationId,
    );
    if (!athlete || athlete.sessionId !== sessionId) return { outcome: 'forbidden' as const };
    const result = await saveEvaluationDraft(
      {
        organizationId: scoped.value.current.organization.id,
        tryoutId: scoped.value.session.tryoutId,
        divisionId: athlete.divisionId,
        registrationId: athlete.registrationId,
        sessionId,
        groupId: athlete.groupId,
        evaluatorUserId: scoped.value.current.userId,
        rubricVersionId: scoped.value.rubricVersionId,
        scores: parsed.data.scores,
        note: parsed.data.note,
        noteTagIds: parsed.data.noteTagIds,
        flags: parsed.data.flags,
      },
      scoped.value.current.authorization,
      parsed.data.expectedVersion,
      { gateway: new SupabaseEvaluationGateway(scoped.value.current.client) },
    );
    return result.ok
      ? { outcome: 'saved' as const, ...result.value }
      : { outcome: result.error.code };
  }

  async function onComplete(input: unknown) {
    'use server';
    const parsed = completeSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'unexpected' as const };
    const scoped = await loadEvaluatorSession(organizationSlug, sessionId);
    if (scoped.outcome !== 'ready')
      return { outcome: scoped.outcome as 'forbidden' | 'unexpected' };
    const athlete = scoped.value.athletes.find(
      (candidate) => candidate.registrationId === registrationId,
    );
    if (!athlete || athlete.sessionId !== sessionId) return { outcome: 'forbidden' as const };
    const { data: ownedEvaluation, error } = await scoped.value.current.client
      .from('evaluations')
      .select('id')
      .eq('organization_id', scoped.value.current.organization.id)
      .eq('tryout_id', scoped.value.session.tryoutId)
      .eq('tryout_registration_id', registrationId)
      .eq('tryout_session_id', sessionId)
      .eq('evaluator_user_id', scoped.value.current.userId)
      .eq('id', parsed.data.evaluationId)
      .maybeSingle();
    if (error) return { outcome: 'unexpected' as const };
    if (!ownedEvaluation) return { outcome: 'forbidden' as const };
    const result = await completeEvaluationRecord(
      {
        organizationId: scoped.value.current.organization.id,
        tryoutId: scoped.value.session.tryoutId,
        divisionId: athlete.divisionId,
        sessionId,
        groupId: athlete.groupId,
        evaluationId: ownedEvaluation.id,
      },
      scoped.value.current.authorization,
      parsed.data.expectedVersion,
      { gateway: new SupabaseEvaluationGateway(scoped.value.current.client) },
    );
    return result.ok
      ? { outcome: 'completed' as const, version: result.value.version }
      : {
          outcome:
            result.error.code === 'invalid_input' ? ('unexpected' as const) : result.error.code,
        };
  }

  return (
    <section aria-labelledby="athlete-heading" className="mx-auto grid min-w-0 max-w-3xl gap-5">
      <AthletePager
        ariaLabel="Athlete navigation above scoring"
        currentIndex={athleteIndex}
        nextHref={next ? `${basePath}/athletes/${next.registrationId}` : null}
        previousHref={previous ? `${basePath}/athletes/${previous.registrationId}` : null}
        total={loaded.value.athletes.length}
      />
      <EvaluationForm
        athlete={{
          registrationId: ownDraft.athlete.registrationId,
          displayName: ownDraft.athlete.displayName,
          identityMode: ownDraft.athlete.identityMode,
          tryoutNumber: ownDraft.athlete.tryoutNumber,
          divisionName: ownDraft.athlete.divisionName,
          sessionName: ownDraft.athlete.sessionName,
          groupName: ownDraft.athlete.groupName,
        }}
        categories={loaded.value.categories}
        draftCacheKey={`${loaded.value.current.userId}:${loaded.value.current.organization.id}:${loaded.value.session.tryoutId}:${sessionId}:${registrationId}:${loaded.value.rubricVersionId}`}
        initialDraft={ownDraft.draft}
        noteTags={loaded.value.noteTags}
        onComplete={onComplete}
        onSave={onSave}
      />
      <AthletePager
        ariaLabel="Athlete navigation below scoring"
        currentIndex={athleteIndex}
        nextHref={next ? `${basePath}/athletes/${next.registrationId}` : null}
        previousHref={previous ? `${basePath}/athletes/${previous.registrationId}` : null}
        total={loaded.value.athletes.length}
      />
    </section>
  );
}
