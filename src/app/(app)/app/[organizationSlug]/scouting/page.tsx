import { FeedbackButton } from '@/components/ui/button';
import { FilterPanel } from '@/modules/talent/ui/filter-panel';
import Link from 'next/link';
import { ArrowUpRight, Plus, Search, ShieldCheck } from 'lucide-react';
import { SavedViews } from '@/modules/talent/ui/saved-views';
import { loadTalent } from '@/modules/talent/application/workspace';
import { EditRecord } from '@/modules/talent/ui/record-form';
import {
  recordDefaults,
  recordFields,
  options,
  profileDefaults,
  profileFields,
  pickValues,
} from '@/modules/talent/ui/fields';
import { ScoutingCards } from '@/modules/talent/ui/scouting-cards';
import {
  EmptyState,
  SectionHeading,
  StatusPill,
  WorkspaceHeader,
  WorkspaceStats,
} from '@/modules/talent/ui/workspace-ui';
const sections: [string, string][] = [
  ['pipeline', 'Pipeline'],
  ['report', 'Reports'],
  ['watchlist', 'Watchlists'],
  ['task', 'Follow-ups'],
  ['video', 'Video evidence'],
  ['goal', 'Development'],
];
const recordLabels: Record<string, { singular: string; description: string }> = {
  report: {
    singular: 'report',
    description: 'Observations, strengths and recommendations from your scouting team.',
  },
  watchlist: {
    singular: 'watchlist entry',
    description: 'Keep the athletes you want to revisit in one place.',
  },
  task: {
    singular: 'follow-up',
    description: 'Assign the next observation and keep every prospect moving.',
  },
  video: {
    singular: 'video reference',
    description: 'Connect key moments to the athlete and skill you are evaluating.',
  },
  goal: {
    singular: 'development goal',
    description: 'Turn your observations into a clear plan for improvement.',
  },
};
export default async function ScoutingPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{
    kind?: string;
    athlete?: string;
    q?: string;
    status?: string;
    stage?: string;
  }>;
}) {
  const { organizationSlug: slug } = await params;
  const f = await searchParams;
  const w = await loadTalent(slug);
  const kind = sections.some(([key]) => key === f.kind) ? f.kind! : 'pipeline';
  const athletes = w.athletes.map((a) => ({
    value: a.id,
    label: `${a.given_name} ${a.family_name}`,
  }));
  const people = w.people.map((e) => ({ value: e.user_id, label: e.display_name }));
  const athleteNames = new Map(athletes.map((a) => [a.value, a.label]));
  const profileByAthlete = new Map(w.profiles.map((p) => [p.athlete_id, p]));
  const records = w.records.filter(
    (r) =>
      r.kind === kind &&
      (!f.athlete || r.athlete_id === f.athlete) &&
      (!f.status || r.status === f.status) &&
      (!f.q ||
        `${r.title} ${r.body} ${athleteNames.get(r.athlete_id)}`
          .toLowerCase()
          .includes(f.q.toLowerCase())),
  );
  const prospects = w.athletes.filter((a) => {
    const p = profileByAthlete.get(a.id);
    return (
      (!f.stage || (p?.stage ?? 'identified') === f.stage) &&
      (!f.athlete || a.id === f.athlete) &&
      (!f.q ||
        `${a.given_name} ${a.family_name} ${p?.current_team ?? ''} ${p?.primary_position ?? ''} ${p?.tags ?? ''}`
          .toLowerCase()
          .includes(f.q.toLowerCase()))
    );
  });
  const label = recordLabels[kind] ?? recordLabels.report!;
  const hasFilters = Boolean(f.q || f.athlete || f.status || f.stage);
  const addRecord =
    kind !== 'pipeline' ? (
      <EditRecord
        slug={slug}
        table="scouting_records"
        title={`Add ${label.singular}`}
        triggerClassName="button-primary"
        defaults={{ ...recordDefaults, kind, athlete_id: f.athlete ?? '' }}
        fields={recordFields(kind, athletes, people)}
      />
    ) : null;
  return (
    <section className="talent-stack talent-workspace">
      <WorkspaceHeader
        eyebrow="Recruitment & development"
        title="Scouting workspace"
        description="A clear view of your prospects, evidence and next decisions."
      >
        {kind === 'pipeline' ? (
          <Link className="button-primary" href={`/app/${slug}/athletes/new`}>
            <Plus size={16} aria-hidden="true" />
            Add prospect
          </Link>
        ) : (
          addRecord
        )}
      </WorkspaceHeader>
      <WorkspaceStats
        items={[
          {
            label: 'Prospects',
            value: w.athletes.length,
            detail: 'Across your organization',
            href: '?kind=pipeline',
          },
          {
            label: 'In observation',
            value: w.profiles.filter((p) =>
              ['observe', 'follow_up', 'evaluating'].includes(p.stage),
            ).length,
            detail: 'Observe, follow up or evaluate',
          },
          {
            label: 'Open follow-ups',
            value: w.records.filter(
              (r) => r.kind === 'task' && !['complete', 'archived'].includes(r.status),
            ).length,
            detail: 'Next actions to complete',
            href: '?kind=task',
          },
          {
            label: 'Reports in review',
            value: w.records.filter((r) => r.kind === 'report' && r.status === 'in_review').length,
            detail: 'Awaiting a decision',
            href: '?kind=report&status=in_review',
          },
        ]}
      />
      <nav className="talent-tabs" aria-label="Scouting sections">
        {sections.map(([key, text]) => (
          <Link
            key={key}
            href={`?kind=${key}${f.athlete ? `&athlete=${encodeURIComponent(f.athlete)}` : ''}`}
            aria-current={kind === key ? 'page' : undefined}
          >
            {text}
            <span className="talent-tab-count">
              {key === 'pipeline'
                ? w.athletes.length
                : w.records.filter((r) => r.kind === key).length}
            </span>
          </Link>
        ))}
      </nav>
      <FilterPanel active={hasFilters}>
        <div className="talent-filter-panel">
          <form className="talent-search" aria-label="Filter scouting workspace">
            <input type="hidden" name="kind" value={kind} />
            <label className="talent-search-main">
              Search
              <div className="talent-search-input">
                <Search size={17} aria-hidden="true" />
                <input
                  name="q"
                  defaultValue={f.q}
                  placeholder={
                    kind === 'pipeline' ? 'Name, position, club or tag' : 'Athlete, title or notes'
                  }
                />
              </div>
            </label>
            {kind === 'pipeline' ? (
              <label>
                Recruitment stage
                <select name="stage" defaultValue={f.stage}>
                  <option value="">All stages</option>
                  {options([
                    'identified',
                    'observe',
                    'follow_up',
                    'invited',
                    'evaluating',
                    'selected',
                    'monitor',
                    'closed',
                  ]).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label>
                  Athlete
                  <select name="athlete" defaultValue={f.athlete}>
                    <option value="">All athletes</option>
                    {athletes.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select name="status" defaultValue={f.status}>
                    <option value="">All statuses</option>
                    {options([
                      'draft',
                      'active',
                      'in_review',
                      'approved',
                      'complete',
                      'archived',
                    ]).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {kind === 'pipeline' && f.athlete && (
              <input type="hidden" name="athlete" value={f.athlete} />
            )}
            <FeedbackButton className="button-secondary">Apply filters</FeedbackButton>
            {hasFilters && (
              <Link className="talent-text-link" href={`?kind=${kind}`}>
                Clear filters
              </Link>
            )}
          </form>
          <SavedViews slug={slug} userId={w.current.userId} />
        </div>
      </FilterPanel>
      {kind === 'pipeline' ? (
        <>
          <SectionHeading
            title="Prospect pipeline"
            description={`${prospects.length} ${prospects.length === 1 ? 'athlete' : 'athletes'}${hasFilters ? ' match your filters' : ' in your scouting workspace'}. Open a profile to review the full picture.`}
          />
          {!prospects.length ? (
            <EmptyState
              title={hasFilters ? 'No matching prospects' : 'Build your prospect list'}
              description={
                hasFilters
                  ? 'Try a different name or recruitment stage, or clear the filters.'
                  : 'Add an athlete to track their sporting background, observations and next steps.'
              }
            >
              <Link
                className="button-secondary"
                href={hasFilters ? '?kind=pipeline' : `/app/${slug}/athletes/new`}
              >
                {hasFilters ? 'Clear filters' : 'Add your first prospect'}
              </Link>
            </EmptyState>
          ) : (
            <div className="talent-prospect-list">
              <div className="talent-prospect-columns" aria-hidden="true">
                <span>Athlete</span>
                <span>Club & level</span>
                <span>Recruitment stage</span>
                <span>Actions</span>
              </div>
              {prospects.map((a) => {
                const p = profileByAthlete.get(a.id);
                const defaults = { ...profileDefaults, athlete_id: a.id };
                return (
                  <article className="talent-prospect-row" key={a.id}>
                    <Link className="talent-person" href={`/app/${slug}/athletes/${a.id}`}>
                      <span className="talent-avatar" aria-hidden="true">
                        {a.given_name[0]}
                        {a.family_name[0]}
                      </span>
                      <span>
                        <strong>
                          {a.given_name} {a.family_name}
                        </strong>
                        <small>{p?.primary_position || 'Position to be added'}</small>
                      </span>
                    </Link>
                    <div className="talent-prospect-club">
                      <strong>{p?.current_team || 'Club to be added'}</strong>
                      <small>{p?.competitive_level || 'Level not recorded'}</small>
                    </div>
                    <div>
                      <StatusPill
                        tone={
                          p?.stage === 'selected'
                            ? 'success'
                            : ['observe', 'follow_up', 'evaluating'].includes(p?.stage ?? '')
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {options([p?.stage ?? 'identified'])[0]!.label}
                      </StatusPill>
                    </div>
                    <div className="talent-row-actions">
                      <EditRecord
                        slug={slug}
                        table="athlete_sport_profiles"
                        id={p?.id}
                        version={p?.version ?? 0}
                        defaults={defaults}
                        initial={p ? pickValues(p, defaults) : undefined}
                        fields={profileFields.filter((field) =>
                          ['stage', 'tags'].includes(field.name),
                        )}
                        title="Update stage"
                      />
                      <Link
                        className="talent-icon-button"
                        href={`/app/${slug}/athletes/${a.id}`}
                        aria-label={`Open ${a.given_name} ${a.family_name}`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <SectionHeading
            title={sections.find(([key]) => key === kind)![1]}
            description={`${records.length} ${records.length === 1 ? 'record' : 'records'} · ${label.description}`}
          />
          {records.length ? (
            <ScoutingCards
              reviewable={['owner', 'administrator'].includes(
                w.current.authorization.organizationRole,
              )}
              slug={slug}
              records={records}
              athletes={athletes}
              people={people}
            />
          ) : (
            <EmptyState
              title={
                hasFilters
                  ? 'No matching records'
                  : `Your ${sections.find(([key]) => key === kind)![1].toLowerCase()} start here`
              }
              description={
                hasFilters
                  ? 'Adjust your filters to find the evidence you need.'
                  : label.description
              }
            >
              {hasFilters ? (
                <Link className="button-secondary" href={`?kind=${kind}`}>
                  Clear filters
                </Link>
              ) : (
                addRecord
              )}
            </EmptyState>
          )}
          <p className="talent-privacy-note">
            <ShieldCheck size={16} aria-hidden="true" />
            Private notes stay with their author. Athlete feedback is shared only after organizer
            approval.
          </p>
        </>
      )}
    </section>
  );
}
