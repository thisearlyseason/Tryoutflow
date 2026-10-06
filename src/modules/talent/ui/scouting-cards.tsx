import { EmptyState, StatusPill } from './workspace-ui';
import { videoMoment } from '../domain/video';
import Link from 'next/link';
import type { Row } from '../application/workspace';
import { EditRecord } from './record-form';
import { recordDefaults, recordFields, pickValues } from './fields';
const kindLabels: Record<string, string> = {
  report: 'Report',
  task: 'Follow-up',
  goal: 'Development goal',
  video: 'Video evidence',
  watchlist: 'Watchlist entry',
};
export function ScoutingCards({
  records,
  slug,
  athletes,
  people,
  fixedAthlete = false,
  reviewable = false,
}: {
  records: Row<'scouting_records'>[];
  slug: string;
  athletes: { value: string; label: string }[];
  people: { value: string; label: string }[];
  fixedAthlete?: boolean;
  reviewable?: boolean;
}) {
  if (!records.length)
    return (
      <EmptyState
        title="No evidence recorded yet"
        description="Add an observation, follow-up or video reference to build this athlete’s story."
      />
    );
  return (
    <div className="talent-grid talent-record-grid">
      {records.map((r) => (
        <article className="talent-card talent-record-card" key={r.id}>
          <div className="talent-toolbar">
            <span className="talent-tag">{kindLabels[r.kind] ?? r.kind}</span>
            <StatusPill
              tone={
                r.status === 'approved' || r.status === 'complete'
                  ? 'success'
                  : r.status === 'in_review'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {r.status.replaceAll('_', ' ')}
            </StatusPill>
          </div>
          <h3>{r.title}</h3>
          <p className="talent-meta">
            Author: {people.find((p) => p.value === r.created_by)?.label || 'Staff member'} ·
            updated {r.updated_at.slice(0, 10)}
          </p>
          {!fixedAthlete && (
            <Link className="talent-record-athlete" href={`/app/${slug}/athletes/${r.athlete_id}`}>
              {athletes.find((a) => a.value === r.athlete_id)?.label ?? 'Athlete'}
            </Link>
          )}
          <p className="talent-meta">
            {r.observation_type} · {r.event_context || 'Event context not recorded'}
            {r.criterion ? ` · ${r.criterion}` : ''}
          </p>
          <div className="talent-record-body">
            {r.review_feedback && (
              <p>
                <strong>Reviewer feedback</strong>
                <br />
                {r.review_feedback}
              </p>
            )}
            {r.source && (
              <p className="talent-meta">
                {r.source}
                {r.observed_at
                  ? ` · ${new Date(r.observed_at).toLocaleDateString('en-CA', { timeZone: 'UTC' })}`
                  : ''}
              </p>
            )}
            {r.body && <p>{r.body}</p>}
            {r.strengths && (
              <p>
                <strong>Strengths</strong>
                <br />
                {r.strengths}
              </p>
            )}
            {r.development_areas && (
              <p>
                <strong>Development areas</strong>
                <br />
                {r.development_areas}
              </p>
            )}
            {r.recommendation && (
              <p>
                <strong>Next step</strong>
                <br />
                {r.recommendation}
              </p>
            )}
            {r.due_on && (
              <p className="talent-meta">
                Due {r.due_on}
                {r.assigned_user_id
                  ? ` · ${people.find((p) => p.value === r.assigned_user_id)?.label ?? 'Assigned staff member'}`
                  : ''}
              </p>
            )}
            {r.video_url && (
              <p>
                <a
                  href={videoMoment(r.video_url, r.start_seconds, r.end_seconds)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button-secondary"
                >
                  Open video evidence ↗
                </a>
                {r.start_seconds !== null && (
                  <small>
                    {' '}
                    Clip {r.start_seconds}s{r.end_seconds !== null ? `–${r.end_seconds}s` : ''}
                  </small>
                )}
              </p>
            )}
          </div>
          <p className="talent-meta">
            {r.visibility === 'athlete'
              ? 'Approved athlete feedback'
              : r.visibility === 'private'
                ? 'Private · only you'
                : 'Shared with scouting staff'}
          </p>
          <EditRecord
            slug={slug}
            table="scouting_records"
            id={r.id}
            version={r.version}
            title={`Edit ${(kindLabels[r.kind] ?? r.kind).toLowerCase()}`}
            fields={[
              ...recordFields(r.kind, athletes, people, fixedAthlete),
              ...(reviewable
                ? [
                    {
                      name: 'review_feedback',
                      label: 'Reviewer feedback',
                      type: 'textarea' as const,
                      help: 'Explain evidence gaps or what the scout should observe next.',
                    },
                  ]
                : []),
            ]}
            initial={pickValues(r, recordDefaults)}
            defaults={recordDefaults}
          />
        </article>
      ))}
    </div>
  );
}
