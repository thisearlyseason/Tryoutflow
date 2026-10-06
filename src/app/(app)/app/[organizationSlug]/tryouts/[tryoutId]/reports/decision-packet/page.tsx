import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadDecisionPacketWorkspace, pages } from '@/modules/talent/application/workspace';
import { PrintReport } from '@/modules/talent/ui/report-actions';
import { PerformanceView } from '@/modules/talent/ui/performance-view';
import { ScenarioComparison } from '@/modules/talent/ui/scenario-comparison';
import { SupabaseRankingGateway } from '@/modules/rankings/infrastructure/supabase-ranking-gateway';
import { buildRankingRows } from '@/modules/rankings/application/list-rankings';
import { videoMoment } from '@/modules/talent/domain/video';
export default async function Page({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug: slug, tryoutId } = await params;
  const w = await loadDecisionPacketWorkspace(slug, tryoutId);
  const c = w.current;
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  const event = w.tryouts.find((t) => t.id === tryoutId);
  if (!event) notFound();
  const [ranking, scenarios, members] = await Promise.all([
    new SupabaseRankingGateway(c.client).load({ organizationId: c.organization.id, tryoutId }),
    w.scoutingIncluded
      ? pages(
          (o) =>
            c.client
              .from('roster_scenarios')
              .select('*')
              .eq('organization_id', c.organization.id)
              .eq('tryout_id', tryoutId)
              .order('id')
              .range(o, o + 999),
          'Scenarios',
        )
      : { data: [], error: null },
    w.scoutingIncluded
      ? pages(
          (o) =>
            c.client
              .from('roster_scenario_members')
              .select('*')
              .eq('organization_id', c.organization.id)
              .order('id')
              .range(o, o + 999),
          'Scenario selections',
        )
      : { data: [], error: null },
  ]);
  if (ranking.outcome !== 'ok' || scenarios.error || members.error)
    throw new Error('Decision packet could not load completely.');
  const rows = buildRankingRows(ranking.snapshot);
  const ids = new Set(rows.map((r) => r.athleteId));
  const sessionIds = new Set(w.sessions.filter((s) => s.tryout_id === tryoutId).map((s) => s.id));
  const measurements = w.results.filter(
    (r) => r.session_id && sessionIds.has(r.session_id) && ids.has(r.athlete_id),
  );
  const records = w.records.filter(
    (r) => ids.has(r.athlete_id) && r.visibility !== 'private' && r.status !== 'archived',
  );
  return (
    <article className="talent-stack talent-report">
      <header className="talent-toolbar">
        <div>
          <p className="eyebrow">{c.organization.name} · Confidential staff report</p>
          <h1>{event.name}: decision packet</h1>
          <p>
            Generated {new Date().toISOString()} · Ranking evidence as of{' '}
            {ranking.snapshot.generatedAt}
          </p>
        </div>
        <PrintReport />
      </header>
      <p>
        Scores use completed, active evaluations. Blank results mean no completed evidence.{' '}
        {w.scoutingIncluded
          ? 'Scouting observations are labeled with their own source and date; they may predate this event.'
          : 'This report includes evaluation evidence for this tryout.'}
      </p>
      <section className="talent-card">
        <h2>Scores, coverage and disagreement</h2>
        <div className="talent-table">
          <table>
            <thead>
              <tr>
                <th>Athlete / position</th>
                <th>Overall / 100</th>
                <th>Coverage</th>
                <th>Evaluator score range</th>
                <th>Category results / 100</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.registrationId}>
                  <td>
                    <Link href={`/app/${slug}/athletes/${r.athleteId}?tab=evaluations`}>
                      {r.displayName}
                    </Link>
                    <br />
                    {r.positionName || r.divisionName}
                  </td>
                  <td>{r.overall ?? 'No completed evidence'}</td>
                  <td>
                    {r.completedEvaluators}/{r.expectedEvaluators} complete
                  </td>
                  <td>{r.scoreRange?.join('–') ?? 'Unavailable'}</td>
                  <td>
                    {r.categories.map((cat) => (
                      <div key={cat.categoryId}>
                        {cat.name}: {cat.normalizedAverage}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Ranges show evaluator spread, not a confidence interval. Review different observation
          contexts before drawing conclusions.
        </p>
        <Link
          className="talent-no-print"
          href={`/app/${slug}/tryouts/${tryoutId}/coverage?filter=missing`}
        >
          Resolve missing observations
        </Link>
      </section>
      {w.scoutingIncluded && (
        <>
          <h2>Event measurements</h2>
          <p>
            Only trials explicitly linked to this event’s sessions are included. Position, age and
            protocol differences still matter.
          </p>
          <PerformanceView
            slug={slug}
            metrics={w.metrics}
            results={measurements}
            athletes={w.athletes}
          />
          <h2>Shared scouting evidence and next steps</h2>
          {records.length ? (
            records.map((r) => (
              <section key={r.id} className="talent-card">
                <h3>
                  {w.athletes.find((a) => a.id === r.athlete_id)?.given_name}{' '}
                  {w.athletes.find((a) => a.id === r.athlete_id)?.family_name}: {r.title}
                </h3>
                <p className="talent-meta">
                  {r.kind} · {r.status} · {r.source || 'Source not recorded'} · observed{' '}
                  {r.observed_at?.slice(0, 10) || 'date not recorded'} · author{' '}
                  {w.people.find((p) => p.user_id === r.created_by)?.display_name || 'Staff member'}
                </p>
                <p>{r.body}</p>
                {r.strengths && (
                  <p>
                    <strong>Strengths: </strong>
                    {r.strengths}
                  </p>
                )}
                {r.development_areas && (
                  <p>
                    <strong>Development: </strong>
                    {r.development_areas}
                  </p>
                )}
                {r.recommendation && (
                  <p>
                    <strong>Next step: </strong>
                    {r.recommendation}
                  </p>
                )}
                {r.video_url && (
                  <a
                    href={videoMoment(r.video_url, r.start_seconds, r.end_seconds)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View video evidence
                  </a>
                )}
              </section>
            ))
          ) : (
            <p>No shared observations for these athletes.</p>
          )}
          <ScenarioComparison
            scenarios={scenarios.data ?? []}
            members={members.data ?? []}
            athletes={w.athletes}
            slug={slug}
          />
          <h2>Recorded selection rationale</h2>
          {scenarios.data?.length ? (
            scenarios.data.map((s) => (
              <section key={s.id} className="talent-card">
                <h3>
                  {s.name} · {s.status}
                </h3>
                <p>{s.rationale || 'Rationale not recorded'}</p>
                <p>
                  Revision {s.version} · updated {s.updated_at}
                </p>
                <ul>
                  {members.data
                    ?.filter((m) => m.scenario_id === s.id)
                    .map((m) => (
                      <li key={m.id}>
                        {w.athletes.find((a) => a.id === m.athlete_id)?.given_name}{' '}
                        {w.athletes.find((a) => a.id === m.athlete_id)?.family_name} ·{' '}
                        {m.role || 'Role needed'} · {m.response}:{' '}
                        {m.rationale || 'Rationale not recorded'}
                      </li>
                    ))}
                </ul>
              </section>
            ))
          ) : (
            <p>No roster scenarios recorded.</p>
          )}
        </>
      )}
      <footer>
        <p>
          Prepared for internal review. Final selections are published separately through the roster
          workspace. This packet reflects the revisions listed above.
        </p>
      </footer>
    </article>
  );
}
