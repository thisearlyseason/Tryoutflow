import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { CalibrationForm } from '@/modules/talent/ui/calibration-forms';
type Case = {
  id: string;
  title: string;
  prompt: string;
  rubric_guidance: string;
  anchor_score: number | null;
  anchor_explanation: string | null;
  attempts: { user_id: string; score: number; rationale: string; created_at: string }[];
};
export default async function Page({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug: slug } = await params;
  const c = await requireCurrentOrganization(slug);
  const upgrade = await billingUpgradePrompt(c.organization.id, slug, 'advanced_evaluations');
  if (upgrade) return upgrade;
  const manager = ['owner', 'administrator'].includes(c.authorization.organizationRole);
  const { data, error } = await c.client.rpc('calibration_workspace', {
    p_organization_id: c.organization.id,
  });
  if (error) throw new Error('Calibration could not load.');
  const cases = (Array.isArray(data) ? data : []) as unknown as Case[];
  const people = manager
    ? await c.client
        .from('evaluator_sport_profiles')
        .select('user_id,display_name')
        .eq('organization_id', c.organization.id)
    : null;
  return (
    <section className="talent-stack">
      <h1>Evaluator calibration</h1>
      <p>
        Practice scoring a shared observation before evaluating athletes. Reference answers appear
        after submission. Differences guide a discussion; they do not automatically change athlete
        scores or evaluator weights.
      </p>
      {manager && <CalibrationForm slug={slug} />}
      <div className="talent-stack">
        {cases.map((k) => (
          <article className="talent-card talent-stack" key={k.id}>
            <h2>{k.title}</h2>
            <p className="talent-prose">{k.prompt}</p>
            <h3>Rubric guidance</h3>
            <p className="talent-prose">{k.rubric_guidance}</p>
            {!manager && !k.attempts.some((a) => a.user_id === c.userId) && (
              <CalibrationForm slug={slug} caseId={k.id} />
            )}{' '}
            {k.anchor_score !== null && (
              <section className="talent-callout">
                <h3>Reference: {k.anchor_score}/10</h3>
                <p>{k.anchor_explanation}</p>
              </section>
            )}
            {k.attempts.map((a) => (
              <section key={a.user_id}>
                <h3>
                  {people?.data?.find((p) => p.user_id === a.user_id)?.display_name ||
                    (a.user_id === c.userId ? 'Your assessment' : 'Evaluator profile incomplete')}
                </h3>
                <p>
                  {a.score}/10 · difference from reference{' '}
                  {k.anchor_score !== null ? Math.abs(a.score - k.anchor_score) : '—'} points
                </p>
                <p>{a.rationale}</p>
              </section>
            ))}
          </article>
        ))}
      </div>
      {!cases.length && <p>No calibration cases are available yet.</p>}
    </section>
  );
}
