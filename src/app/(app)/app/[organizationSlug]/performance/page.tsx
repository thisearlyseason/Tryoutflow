import { FeedbackButton } from '@/components/ui/button';
import { Upload } from 'lucide-react';
import {
  WorkspaceHeader,
  WorkspaceStats,
  SectionHeading,
  EmptyState,
} from '@/modules/talent/ui/workspace-ui';
import { SavedViews } from '@/modules/talent/ui/saved-views';
import Link from 'next/link';
import { loadTalent } from '@/modules/talent/application/workspace';
import { EditRecord } from '@/modules/talent/ui/record-form';
import { metricDefaults, metricFields, resultDefaults } from '@/modules/talent/ui/fields';
import { PerformanceView, resultFields } from '@/modules/talent/ui/performance-view';
import { sportTemplates } from '@/modules/talent/domain/performance';
export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    sport?: string;
    position?: string;
    session?: string;
    from?: string;
    to?: string;
    metric?: string;
    level?: string;
    minAge?: string;
    maxAge?: string;
    asOf?: string;
  }>;
}) {
  const { organizationSlug: slug } = await params;
  const f = await searchParams;
  const w = await loadTalent(slug, undefined, f);
  const athletes = w.athletes.map((a) => ({
    value: a.id,
    label: `${a.given_name} ${a.family_name}`,
  }));
  const sessions = w.sessions.map((s) => ({ value: s.id, label: s.name }));
  const metrics = w.metrics.filter(
    (m) => (!f.sport || m.sport === f.sport) && (!f.metric || m.id === f.metric),
  );
  const age = (id: string) => {
    const birth = w.athletes.find((a) => a.id === id)?.birth_date;
    if (!birth) return null;
    const asOf = f.asOf || new Date().toISOString().slice(0, 10);
    return (
      Number(asOf.slice(0, 4)) -
      Number(birth.slice(0, 4)) -
      (asOf.slice(5) < birth.slice(5) ? 1 : 0)
    );
  };
  const metricIds = new Set(metrics.map((m) => m.id));
  const results = w.results.filter(
    (r) =>
      metricIds.has(r.metric_id) &&
      (!f.level ||
        w.profiles.find((p) => p.athlete_id === r.athlete_id)?.competitive_level === f.level) &&
      (!f.minAge || (age(r.athlete_id) !== null && age(r.athlete_id)! >= Number(f.minAge))) &&
      (!f.maxAge || (age(r.athlete_id) !== null && age(r.athlete_id)! <= Number(f.maxAge))) &&
      (!f.session || r.session_id === f.session) &&
      (!f.from || r.measured_at.slice(0, 10) >= f.from) &&
      (!f.to || r.measured_at.slice(0, 10) <= f.to) &&
      (!f.position ||
        w.profiles.find((p) => p.athlete_id === r.athlete_id)?.primary_position === f.position),
  );
  return (
    <section className="talent-stack">
      <WorkspaceHeader
        eyebrow="Measured performance"
        title="Performance lab"
        description="Compare athletes using consistent tests, recorded trials and verified sources."
      >
        <Link className="button-secondary" href={`/app/${slug}/performance/import`}>
          <Upload size={16} aria-hidden="true" />
          Import CSV
        </Link>
        <EditRecord
          slug={slug}
          table="performance_results"
          title="Record a measurement"
          triggerClassName="button-primary"
          defaults={{ ...resultDefaults, measured_at: new Date().toISOString() }}
          fields={resultFields(athletes, w.metrics, sessions)}
        />
      </WorkspaceHeader>
      <WorkspaceStats
        items={[
          { label: 'Measurements', value: results.length, detail: 'In the selected cohort' },
          {
            label: 'Athletes measured',
            value: new Set(results.map((r) => r.athlete_id)).size,
            detail: 'With a recorded attempt',
          },
          {
            label: 'Verified results',
            value: results.filter((r) => r.verified && r.status === 'valid').length,
            detail: 'Valid and source checked',
          },
          { label: 'Metrics', value: w.metrics.length, detail: 'Defined tests and protocols' },
        ]}
      />
      <details
        className="talent-filters-details"
        open={Object.entries(f).some(([key, value]) => key !== 'asOf' && Boolean(value))}
      >
        <summary>
          Filter the comparison cohort
          {Object.entries(f).some(([key, value]) => key !== 'asOf' && Boolean(value))
            ? ' · filters applied'
            : ''}
        </summary>
        <div className="talent-filter-panel">
          <form className="talent-search">
            <label>
              Sport
              <select name="sport" defaultValue={f.sport}>
                <option value="">All sports</option>
                {[...new Set(w.metrics.map((m) => m.sport))].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Metric
              <select name="metric" defaultValue={f.metric}>
                <option value="">All metrics</option>
                {w.metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Position
              <select name="position" defaultValue={f.position}>
                <option value="">All positions</option>
                {[...new Set(w.profiles.map((p) => p.primary_position).filter(Boolean))].map(
                  (p) => (
                    <option key={p}>{p}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Session
              <select name="session" defaultValue={f.session}>
                <option value="">All sessions</option>
                {sessions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Level
              <input name="level" defaultValue={f.level} placeholder="Exact competitive level" />
            </label>
            <label>
              Minimum age
              <input type="number" min="0" max="100" name="minAge" defaultValue={f.minAge} />
            </label>
            <label>
              Maximum age
              <input type="number" min="0" max="100" name="maxAge" defaultValue={f.maxAge} />
            </label>
            <label>
              Age as of
              <input
                type="date"
                name="asOf"
                defaultValue={f.asOf || new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label>
              From
              <input type="date" name="from" defaultValue={f.from} />
            </label>
            <label>
              Through
              <input type="date" name="to" defaultValue={f.to} />
            </label>
            <FeedbackButton className="button-secondary">Apply filters</FeedbackButton>
          </form>
          <p className="talent-meta">
            Age filters exclude athletes with unknown birth dates. Keep the protocol, level and
            observation period comparable.
          </p>
          <SavedViews slug={slug} userId={w.current.userId} />
          <Link className="talent-text-link" href={`/app/${slug}/performance`}>
            Clear filters
          </Link>
        </div>
      </details>
      <SectionHeading
        title="Performance comparison"
        description="Results stay connected to their original protocol and observation date."
      />
      <PerformanceView slug={slug} athletes={w.athletes} metrics={metrics} results={results} />
      <section className="talent-catalog">
        <SectionHeading
          title="Metric catalog"
          description="Define what your staff measures before collecting results."
        >
          <EditRecord
            slug={slug}
            table="performance_metrics"
            title="Create a metric"
            defaults={metricDefaults}
            fields={metricFields}
          />
        </SectionHeading>
        {!w.metrics.length && (
          <EmptyState
            title="Choose your first test"
            description="Create a metric or start from one of the sport templates below. Every result will use the same units and protocol."
          />
        )}

        <div className="talent-grid">
          {w.metrics.map((m) => (
            <article className="talent-card" key={m.id}>
              <p className="eyebrow">{m.sport}</p>
              <h3>{m.name}</h3>
              <p>
                {m.unit} · {m.direction === 'neutral' ? 'Descriptive' : `${m.direction} is better`}{' '}
                · {m.aggregation}
              </p>
              <p className="talent-meta">{m.protocol}</p>
            </article>
          ))}
        </div>
        <details className="talent-editor">
          <summary>Start from a sport template</summary>
          <p>
            Review the protocol with your staff before using a template. These are editable starting
            points.
          </p>
          <div className="talent-catalog-templates">
            {sportTemplates.map((t) => (
              <EditRecord
                key={`${t.sport}:${t.name}`}
                slug={slug}
                table="performance_metrics"
                title={`${t.sport} · ${t.name}`}
                defaults={{ ...t }}
                fields={metricFields}
              />
            ))}
          </div>
        </details>
      </section>
    </section>
  );
}
