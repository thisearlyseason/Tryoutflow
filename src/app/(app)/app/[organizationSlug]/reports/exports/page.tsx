import Link from 'next/link';
import { talentContext } from '@/modules/talent/application/workspace';
import { ExportBuilder, ExportRetry } from '@/modules/talent/ui/export-builder';
export const maxDuration = 60;
export default async function Page({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug: slug } = await params;
  const c = await talentContext(slug);
  const [sessions, metrics, history] = await Promise.all([
    c.client
      .from('tryout_sessions')
      .select('id,name')
      .eq('organization_id', c.organization.id)
      .limit(1000),
    c.client
      .from('performance_metrics')
      .select('id,name')
      .eq('organization_id', c.organization.id)
      .limit(1000),
    c.client.rpc('list_performance_exports', { p_organization_id: c.organization.id }),
  ]);
  if (sessions.error || metrics.error || history.error)
    throw new Error('Export options could not load.');
  return (
    <section className="talent-stack">
      <h1>Performance exports</h1>
      <p>
        Prepare up to 50,000 trials / 20 MB in the background. Files contain measured results and
        source details; private scouting notes and contacts are excluded. Downloads require your
        current scouting access and expire after 24 hours.
      </p>
      <ExportBuilder slug={slug} sessions={sessions.data} metrics={metrics.data} />
      <h2>Recent exports</h2>
      {(
        (history.data ?? []) as {
          id: string;
          state: string;
          rows: number | null;
          message: string;
          created_at: string;
          expires_at: string;
        }[]
      ).map((job) => (
        <article className="talent-card" key={job.id}>
          <h3>Performance · {job.created_at.slice(0, 16).replace('T', ' ')} UTC</h3>
          <p>
            {job.state} · {job.rows ?? '—'} trials · expires{' '}
            {job.expires_at.slice(0, 16).replace('T', ' ')} UTC
          </p>
          <p>{job.message}</p>
          {job.state === 'ready' ? (
            <Link className="button-secondary" href={`/app/${slug}/reports/exports/${job.id}`}>
              Download CSV
            </Link>
          ) : (
            <ExportRetry slug={slug} id={job.id} />
          )}
        </article>
      ))}
    </section>
  );
}
