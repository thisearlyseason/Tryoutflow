import { FeedbackButton } from '@/components/ui/button';
import { UserPlus, ClipboardCheck } from 'lucide-react';
import {
  WorkspaceHeader,
  WorkspaceStats,
  EmptyState,
  StatusPill,
} from '@/modules/talent/ui/workspace-ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { EditRecord } from '@/modules/talent/ui/record-form';
import { evaluatorDefaults, evaluatorFields, pickValues } from '@/modules/talent/ui/fields';
export default async function EvaluatorDirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<{ q?: string; readiness?: string }>;
}) {
  const { organizationSlug: slug } = await params;
  const f = await searchParams;
  const c = await requireCurrentOrganization(slug);
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  const [directory, profiles, activity, assignments, events] = await Promise.all([
    c.client.rpc('list_organization_evaluators', { p_organization_id: c.organization.id }),
    c.client.from('evaluator_sport_profiles').select('*').eq('organization_id', c.organization.id),
    c.client
      .from('evaluations')
      .select('evaluator_user_id,state,updated_at')
      .eq('organization_id', c.organization.id)
      .order('updated_at', { ascending: false })
      .limit(1000),
    c.client
      .from('tryout_staff_assignments')
      .select('user_id,tryout_id,scope_kind')
      .eq('organization_id', c.organization.id)
      .eq('role', 'evaluator')
      .is('revoked_at', null),
    c.client.from('tryouts').select('id,name').eq('organization_id', c.organization.id),
  ]);
  if (directory.error || profiles.error || activity.error || assignments.error || events.error)
    return <p role="alert">Evaluator profiles could not load. Refresh and retry.</p>;
  const filtered =
    directory.data?.filter((e) => {
      const p = profiles.data?.find((profile) => profile.user_id === e.evaluator_user_id);
      const ready = Boolean(
        p?.briefing_complete && p?.device_check_complete && p?.assignments_acknowledged,
      );
      return (
        (!f.q ||
          `${p?.display_name ?? e.display_name} ${p?.sport ?? ''} ${p?.specialties ?? ''} ${p?.affiliation ?? ''}`
            .toLowerCase()
            .includes(f.q.toLowerCase())) &&
        (!f.readiness || (f.readiness === 'ready' ? ready : !ready))
      );
    }) ?? [];
  return (
    <section className="talent-stack">
      <WorkspaceHeader
        eyebrow="People & readiness"
        title="Evaluator directory"
        description="The right people, prepared for the right assignments."
      >
        <Link
          prefetch={false}
          className="button-secondary"
          href={`/app/${slug}/evaluate/calibration`}
        >
          <ClipboardCheck size={16} aria-hidden="true" />
          Calibration
        </Link>
        <Link
          prefetch={false}
          className="button-primary"
          href={`/app/${slug}/organization/members`}
        >
          <UserPlus size={16} aria-hidden="true" />
          Invite staff
        </Link>
      </WorkspaceHeader>
      <WorkspaceStats
        items={[
          {
            label: 'Evaluators',
            value: directory.data?.length ?? 0,
            detail: 'Available in your organization',
          },
          {
            label: 'Briefing complete',
            value:
              directory.data?.filter((e) =>
                profiles.data?.some(
                  (p) => p.user_id === e.evaluator_user_id && p.briefing_complete,
                ),
              ).length ?? 0,
            detail: 'Rubric preparation declared',
          },
          {
            label: 'Active assignments',
            value: assignments.data?.length ?? 0,
            detail: 'Across all tryouts',
          },
          {
            label: 'Completed scorecards',
            value:
              activity.data?.filter((a) => ['completed', 'locked'].includes(a.state)).length ?? 0,
            detail: 'In recent activity',
          },
        ]}
      />
      <form className="talent-filter-panel talent-search" aria-label="Filter evaluators">
        <label className="talent-search-main">
          Search evaluators
          <input name="q" defaultValue={f.q} placeholder="Name, sport, specialty or affiliation" />
        </label>
        <label>
          Preparation
          <select name="readiness" defaultValue={f.readiness}>
            <option value="">All evaluators</option>
            <option value="ready">All declarations complete</option>
            <option value="pending">Preparation pending</option>
          </select>
        </label>
        <FeedbackButton className="button-secondary">Apply filters</FeedbackButton>
        {(f.q || f.readiness) && (
          <Link prefetch={false} className="talent-text-link" href={`/app/${slug}/evaluators`}>
            Clear filters
          </Link>
        )}
      </form>
      {Boolean(directory.data?.length) && !filtered.length && (
        <EmptyState
          title="No matching evaluators"
          description="Try a different name or preparation filter."
        >
          <Link prefetch={false} className="button-secondary" href={`/app/${slug}/evaluators`}>
            Clear filters
          </Link>
        </EmptyState>
      )}
      {!directory.data?.length && (
        <EmptyState
          title="Build your evaluation team"
          description="Invite staff, record their specialties and prepare them for a consistent evaluation process."
        >
          <Link
            prefetch={false}
            className="button-secondary"
            href={`/app/${slug}/organization/members`}
          >
            Invite your first evaluator
          </Link>
        </EmptyState>
      )}
      {activity.data?.length === 1000 && (
        <p>
          Activity is limited to the latest 1,000 scorecards. Use event reports for complete event
          coverage.
        </p>
      )}
      <div className="talent-grid talent-staff-grid">
        {filtered.map((e) => {
          const p = profiles.data?.find((x) => x.user_id === e.evaluator_user_id);
          const recent =
            activity.data?.filter((a) => a.evaluator_user_id === e.evaluator_user_id) ?? [];
          const assigned = assignments.data?.filter((a) => a.user_id === e.evaluator_user_id) ?? [];
          return (
            <article className="talent-card" key={e.evaluator_user_id}>
              <div className="talent-staff-heading">
                <span className="talent-avatar" aria-hidden="true">
                  {(p?.display_name ?? e.display_name)
                    .split(' ')
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join('')}
                </span>
                <div>
                  <h2>{p?.display_name ?? e.display_name}</h2>
                  <p>
                    {p?.sport || 'Sport to be added'} · {e.active_assignment_count} assignments
                  </p>
                </div>
              </div>
              <p className="talent-meta">
                {p?.specialties || 'Add specialties to match this evaluator to the right stations.'}
              </p>
              <div className="talent-staff-readiness">
                <StatusPill tone={p?.briefing_complete ? 'success' : 'warning'}>
                  {p?.briefing_complete ? 'Briefing complete' : 'Briefing needed'}
                </StatusPill>
                <StatusPill tone={p?.device_check_complete ? 'success' : 'neutral'}>
                  {p?.device_check_complete ? 'Device checked' : 'Device check pending'}
                </StatusPill>
                <StatusPill tone={p?.assignments_acknowledged ? 'success' : 'neutral'}>
                  {p?.assignments_acknowledged ? 'Assignments reviewed' : 'Assignments to review'}
                </StatusPill>
              </div>
              <div className="talent-staff-activity">
                <div>
                  <strong>
                    {recent.filter((a) => ['completed', 'locked'].includes(a.state)).length}
                  </strong>
                  <span>Completed</span>
                </div>
                <div>
                  <strong>
                    {recent.filter((a) => !['completed', 'locked'].includes(a.state)).length}
                  </strong>
                  <span>In progress</span>
                </div>
              </div>
              <details className="talent-staff-details">
                <summary>Experience & availability</summary>
                <dl>
                  <dt>Affiliation</dt>
                  <dd>{p?.affiliation || 'Not recorded'}</dd>
                  <dt>Experience</dt>
                  <dd>{p?.experience || 'Not recorded'}</dd>
                  <dt>Qualifications</dt>
                  <dd>{p?.qualifications || 'Not recorded'}</dd>
                  <dt>Availability</dt>
                  <dd>{p?.availability || 'Not recorded'}</dd>
                  <dt>Conflict disclosure</dt>
                  <dd>
                    {p?.conflict_disclosure || 'No disclosure recorded — confirm before assigning'}
                  </dd>
                </dl>
              </details>
              <p className="talent-meta">
                {recent[0]
                  ? `Last activity: ${recent[0].updated_at.slice(0, 16).replace('T', ' ')} UTC`
                  : 'No scorecard activity yet'}
              </p>
              <div>
                {[...new Set(assigned.map((a) => a.tryout_id))].map((id) => (
                  <p key={id}>
                    <Link prefetch={false} href={`/app/${slug}/tryouts/${id}/staff`}>
                      {events.data?.find((t) => t.id === id)?.name || 'Tryout'} · manage assignment
                      / recusal →
                    </Link>
                  </p>
                ))}
              </div>
              <EditRecord
                slug={slug}
                table="evaluator_sport_profiles"
                title="Edit evaluator profile"
                id={p?.id}
                version={p?.version ?? 0}
                defaults={{
                  ...evaluatorDefaults,
                  user_id: e.evaluator_user_id,
                  display_name: e.display_name,
                }}
                initial={
                  p
                    ? pickValues(p, { ...evaluatorDefaults, user_id: e.evaluator_user_id })
                    : undefined
                }
                fields={evaluatorFields}
              />
            </article>
          );
        })}
      </div>
      <div className="talent-header-actions">
        <Link prefetch={false} className="button-secondary" href={`/app/${slug}/tryouts`}>
          Choose a tryout to assign staff →
        </Link>
        <Link prefetch={false} className="talent-text-link" href={`/app/${slug}/evaluate/profile`}>
          Edit your own profile →
        </Link>
      </div>
    </section>
  );
}
