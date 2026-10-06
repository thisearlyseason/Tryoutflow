import { z } from 'zod';
import { loadTalent } from '../application/workspace';
export async function EvaluationHistory({
  workspace,
  athleteId,
}: {
  workspace: Awaited<ReturnType<typeof loadTalent>>;
  athleteId: string;
}) {
  const c = workspace.current;
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) return null;
  const { data, error } = await c.client.rpc('load_athlete_evaluation_history', {
    p_organization_id: c.organization.id,
    p_athlete_id: athleteId,
  });
  const parsed = z
    .array(
      z.object({
        id: z.string(),
        tryout_id: z.string(),
        tryout_session_id: z.string(),
        state: z.string(),
        completed_at: z.string().nullable(),
        rubric_version_id: z.string(),
        evaluation_scores: z.array(
          z.object({
            value: z.number().nullable(),
            rubric_category_id: z.string(),
            category_name: z.string(),
          }),
        ),
      }),
    )
    .safeParse(data);
  if (error || !parsed.success) return <p role="alert">Evaluation history could not load.</p>;
  const results = { data: parsed.data };
  return (
    <section className="talent-stack">
      <h2>Tryout scorecards</h2>
      <p>
        Original rubric scores by session. Scorecards from different rubrics are shown separately.
      </p>
      {results.data.length === 200 && (
        <p>
          Showing the latest 200 scorecards. Open the event’s rankings for the complete event
          comparison.
        </p>
      )}
      {!results.data.length ? (
        <p>No scorecards recorded yet.</p>
      ) : (
        results.data.map((e) => (
          <article className="talent-card" key={e.id}>
            <h3>
              {workspace.tryouts.find((t) => t.id === e.tryout_id)?.name} ·{' '}
              {workspace.sessions.find((s) => s.id === e.tryout_session_id)?.name}
            </h3>
            <p>
              {e.state} · {e.completed_at?.slice(0, 10) || 'Not completed'}
            </p>
            <dl>
              {e.evaluation_scores.map((score) => (
                <div key={score.rubric_category_id}>
                  <dt>{score.category_name}</dt>
                  <dd>{score.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))
      )}
    </section>
  );
}
