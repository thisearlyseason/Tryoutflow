import Link from 'next/link';
import { loadTalent } from '@/modules/talent/application/workspace';
import { PrintReport } from '@/modules/talent/ui/report-actions';
import { PerformanceView } from '@/modules/talent/ui/performance-view';
export default async function Page({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug: slug } = await params;
  const w = await loadTalent(slug);
  const reports = w.records.filter((r) => r.kind === 'report' && r.visibility !== 'private');
  const overdue = w.records.filter(
    (r) =>
      r.due_on &&
      r.due_on < new Date().toISOString().slice(0, 10) &&
      !['complete', 'archived'].includes(r.status),
  );
  return (
    <article className="talent-stack talent-report">
      <header className="talent-toolbar">
        <div>
          <p className="eyebrow">{w.current.organization.name} · Confidential</p>
          <h1>Director scouting report</h1>
          <p>Generated {new Date().toISOString()} · Current authorized workspace</p>
        </div>
        <div className="talent-no-print">
          <PrintReport />{' '}
          <Link className="button-secondary" href={`/app/${slug}/reports/exports`}>
            Prepare measurements CSV
          </Link>
        </div>
      </header>
      <div className="talent-stats">
        <div>
          <strong>{w.athletes.length}</strong>
          <span>Athletes</span>
        </div>
        <div>
          <strong>{reports.length}</strong>
          <span>Shared scouting reports</span>
        </div>
        <div>
          <strong>{overdue.length}</strong>
          <span>Overdue follow-ups / goals</span>
        </div>
        <div>
          <strong>{w.results.filter((r) => r.status === 'valid').length}</strong>
          <span>Valid trials</span>
        </div>
      </div>
      <section>
        <h2>Follow-up priorities</h2>
        {overdue.length ? (
          overdue.map((r) => (
            <p key={r.id}>
              <Link href={`/app/${slug}/athletes/${r.athlete_id}`}>
                {w.athletes.find((a) => a.id === r.athlete_id)?.given_name}{' '}
                {w.athletes.find((a) => a.id === r.athlete_id)?.family_name}
              </Link>{' '}
              · {r.title} · due {r.due_on}
            </p>
          ))
        ) : (
          <p>No overdue items in this workspace.</p>
        )}
      </section>
      <h2>Performance summary</h2>
      <p>
        Comparisons use each metric’s protocol. Use the performance lab to narrow age, position,
        session and date before a selection decision.
      </p>
      <PerformanceView slug={slug} athletes={w.athletes} metrics={w.metrics} results={w.results} />
      <h2>Athlete reports</h2>
      {w.athletes.map((a) => (
        <p key={a.id}>
          <Link href={`/app/${slug}/reports/athletes/${a.id}?audience=staff`}>
            {a.given_name} {a.family_name}
          </Link>
        </p>
      ))}
    </article>
  );
}
