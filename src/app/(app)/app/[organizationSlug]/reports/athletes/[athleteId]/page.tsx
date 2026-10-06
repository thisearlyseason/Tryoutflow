import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadTalent } from '@/modules/talent/application/workspace';
import { PerformanceView } from '@/modules/talent/ui/performance-view';
import { PrintReport } from '@/modules/talent/ui/report-actions';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; athleteId: string }>;
  searchParams: Promise<{ audience?: string }>;
}) {
  const { organizationSlug: slug, athleteId } = await params;
  const audience = (await searchParams).audience === 'staff' ? 'staff' : 'athlete';
  const w = await loadTalent(slug, athleteId);
  const a = w.athletes.find((x) => x.id === athleteId);
  if (!a) notFound();
  const p = w.profiles.find((x) => x.athlete_id === athleteId);
  const records = w.records.filter(
    (r) =>
      r.visibility !== 'private' &&
      (audience === 'staff' || (r.visibility === 'athlete' && r.status === 'approved')),
  );
  return (
    <article className="talent-stack talent-report">
      <div className="talent-toolbar talent-no-print">
        <Link href={`/app/${slug}/athletes/${athleteId}`}>← Athlete dossier</Link>
        <Link href={`?audience=${audience === 'staff' ? 'athlete' : 'staff'}`}>
          View {audience === 'staff' ? 'athlete feedback' : 'internal staff report'}
        </Link>
        <PrintReport />
      </div>
      <header>
        <p className="eyebrow">
          {w.current.organization.name} ·{' '}
          {audience === 'staff' ? 'Confidential staff report' : 'Approved athlete feedback'}
        </p>
        <h1>
          {a.given_name} {a.family_name}
        </h1>
        <p>
          {p?.sport} · {p?.primary_position} · {p?.current_team}
        </p>
        <p className="talent-meta">
          Generated {new Date().toISOString().slice(0, 10)} ·{' '}
          {audience === 'staff'
            ? 'For authorized sporting staff'
            : 'Contains only approved athlete-facing observations'}
        </p>
      </header>
      {records.length === 0 ? (
        <p>
          No {audience === 'athlete' ? 'approved athlete-facing' : 'shared'} feedback is available.
        </p>
      ) : (
        records.map((r) => (
          <section className="talent-card" key={r.id}>
            <p className="eyebrow">
              {r.kind} · {r.status} · {r.observed_at?.slice(0, 10) || r.created_at.slice(0, 10)}
            </p>
            <h2>{r.title}</h2>
            <p className="talent-prose">{r.body}</p>
            {r.strengths && (
              <>
                <h3>Strengths</h3>
                <p className="talent-prose">{r.strengths}</p>
              </>
            )}
            {r.development_areas && (
              <>
                <h3>Development priorities</h3>
                <p className="talent-prose">{r.development_areas}</p>
              </>
            )}
            {r.recommendation && (
              <>
                <h3>Next steps</h3>
                <p>{r.recommendation}</p>
              </>
            )}
            {r.due_on && <p>Target: {r.due_on}</p>}
            {r.video_url && (
              <p>
                Evidence:{' '}
                <a href={r.video_url} target="_blank" rel="noreferrer">
                  {r.video_url}
                </a>{' '}
                {r.start_seconds !== null ? `from ${r.start_seconds}s` : ''}
              </p>
            )}
          </section>
        ))
      )}
      {audience === 'staff' && (
        <>
          <h2>Measured performance</h2>
          <PerformanceView
            slug={slug}
            athletes={[a]}
            metrics={w.metrics}
            results={w.results}
            athleteId={athleteId}
          />
        </>
      )}
      <footer>
        Prepared in TryoutFlow ·{' '}
        {audience === 'staff'
          ? 'Internal observations require professional review.'
          : 'Contact your organizer to discuss this development feedback.'}
      </footer>
    </article>
  );
}
