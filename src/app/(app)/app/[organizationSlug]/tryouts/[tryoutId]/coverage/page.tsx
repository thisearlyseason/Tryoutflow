import { parseEventCoverage } from '@/modules/tryouts/application/parse-event-coverage';
import { FeedbackButton } from '@/components/ui/button';
import Link from 'next/link';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { LiveRefresh } from '@/modules/talent/ui/live-refresh';
import { PrintReport } from '@/modules/talent/ui/report-actions';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
  searchParams: Promise<{ filter?: string; session?: string; q?: string }>;
}) {
  const { organizationSlug: slug, tryoutId } = await params;
  const f = await searchParams;
  const c = await requireCurrentOrganization(slug);
  const { data, error } = await c.client.rpc('event_coverage', {
    p_organization_id: c.organization.id,
    p_tryout_id: tryoutId,
  });
  if (error) throw new Error('Coverage could not load. Refresh or check your event access.');
  const all = parseEventCoverage(data);
  if (all === null)
    throw new Error('Coverage is unavailable. Refresh before reviewing observation counts.');
  const complete = (state: string) => ['completed', 'locked'].includes(state);
  const rows = all.filter(
    (r) =>
      (!f.session || r.session_id === f.session) &&
      (!f.q || r.name.toLowerCase().includes(f.q.toLowerCase())) &&
      (!f.filter ||
        f.filter === 'all' ||
        (f.filter === 'missing' &&
          (!r.evaluators.length || r.evaluators.some((e) => !complete(e.state)))) ||
        (f.filter === 'arrival' && !r.checked_in_at) ||
        (f.filter === 'sync' &&
          r.evaluators.some((e) => e.latest_sync_outcome && e.latest_sync_outcome !== 'synced'))),
  );
  return (
    <section className="talent-stack talent-report">
      <header className="talent-toolbar">
        <div>
          <p className="eyebrow">Event operations</p>
          <h1>Athlete × evaluator coverage</h1>
          <p>See which assigned evaluators still need to observe each athlete in each session.</p>
        </div>
        <PrintReport />
      </header>
      <LiveRefresh asOf={new Date().toISOString()} />
      <form className="talent-search">
        <label>
          Athlete
          <input name="q" defaultValue={f.q} />
        </label>
        <label>
          Session
          <select name="session" defaultValue={f.session}>
            <option value="">All authorized sessions</option>
            {[...new Map(all.map((r) => [r.session_id, r.session])).entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select name="filter" defaultValue={f.filter}>
            <option value="all">All placements</option>
            <option value="missing">Missing observations</option>
            <option value="arrival">Not checked in</option>
            <option value="sync">Latest sync receipt needs review</option>
          </select>
        </label>
        <FeedbackButton className="button-secondary">Apply filters</FeedbackButton>
      </form>
      <p className="talent-meta">
        {rows.length} placements. Sync receipts describe the last server response; unsent device
        drafts are not visible here.
      </p>
      <div className="talent-grid">
        {rows.map((r) => (
          <article className="talent-card" key={`${r.registration_id}:${r.session_id}`}>
            <h2>{r.name}</h2>
            <p>
              {r.session} · {r.group || 'No group'}
            </p>
            <p>
              {r.checked_in_at
                ? `Checked in ${r.checked_in_at.slice(11, 16)} UTC`
                : new Date(r.ends_at) < new Date()
                  ? 'Not checked in — session ended'
                  : new Date(r.starts_at) < new Date()
                    ? 'Not checked in — session started'
                    : 'Arrival expected'}
            </p>
            {!r.evaluators.length ? (
              <p role="alert">No evaluator assigned to this placement.</p>
            ) : (
              <ul>
                {r.evaluators.map((e) => (
                  <li key={e.user_id}>
                    <strong>{e.name}</strong> ·{' '}
                    {complete(e.state) ? 'Complete' : e.state.replaceAll('_', ' ')}
                    {e.latest_sync_outcome && e.latest_sync_outcome !== 'synced' && (
                      <span className="talent-tag">
                        Latest sync: {e.latest_sync_outcome.replaceAll('_', ' ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="talent-toolbar">
              <Link href={`/app/${slug}/tryouts/${tryoutId}/staff`}>Resolve staffing</Link>
              <Link href={`/app/${slug}/tryouts/${tryoutId}/check-in`}>Check-in desk</Link>
              <Link
                href={`/app/${slug}/tryouts/${tryoutId}/rankings?search=${encodeURIComponent(r.name)}`}
              >
                View scores
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && <p>No placements match this view.</p>}
    </section>
  );
}
