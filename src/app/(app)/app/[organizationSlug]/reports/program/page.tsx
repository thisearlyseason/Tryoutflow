import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pages } from '@/modules/talent/application/workspace';
import { PrintReport } from '@/modules/talent/ui/report-actions';
export default async function Page({ params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug: slug } = await params;
  const c = await requireCurrentOrganization(slug);
  const upgrade = await billingUpgradePrompt(c.organization.id, slug, 'organization_reporting');
  if (upgrade) return upgrade;
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  const id = c.organization.id;
  const [events, registrations, enrollments, checkins, evaluations, profiles] = await Promise.all([
    pages(
      (o) =>
        c.client
          .from('tryouts')
          .select('id,name,created_at')
          .eq('organization_id', id)
          .order('created_at')
          .order('id')
          .range(o, o + 999),
      'Program events',
    ),
    pages(
      (o) =>
        c.client
          .from('tryout_registrations')
          .select('id,tryout_id,athlete_id,status')
          .eq('organization_id', id)
          .order('id')
          .range(o, o + 999),
      'Program registrations',
    ),
    pages(
      (o) =>
        c.client
          .from('session_enrollments')
          .select('id,tryout_id,registration_id,session_id')
          .eq('organization_id', id)
          .order('id')
          .range(o, o + 999),
      'Program enrollments',
    ),
    c.client.rpc('program_attendance', { p_organization_id: id }),
    pages(
      (o) =>
        c.client
          .from('evaluations')
          .select('id,tryout_id,state')
          .eq('organization_id', id)
          .order('id')
          .range(o, o + 999),
      'Program evaluations',
    ),
    pages(
      (o) =>
        c.client
          .from('athlete_sport_profiles')
          .select('id,stage')
          .eq('organization_id', id)
          .order('id')
          .range(o, o + 999),
      'Program pipeline',
    ),
  ]);
  if ([events, registrations, enrollments, checkins, evaluations, profiles].some((r) => r.error))
    throw new Error('Program report could not load completely.');
  const athletes = new Set(registrations.data?.map((r) => r.athlete_id));
  const returning = [...athletes].filter(
    (a) =>
      new Set(registrations.data?.filter((r) => r.athlete_id === a).map((r) => r.tryout_id)).size >
      1,
  ).length;
  return (
    <article className="talent-stack talent-report">
      <header className="talent-toolbar">
        <div>
          <p className="eyebrow">{c.organization.name}</p>
          <h1>Program participation and progression</h1>
          <p>Generated {new Date().toISOString()} · All recorded events</p>
        </div>
        <PrintReport />
      </header>
      <div className="talent-stats">
        <div>
          <strong>{events.data?.length}</strong>
          <span>Events</span>
        </div>
        <div>
          <strong>{athletes.size}</strong>
          <span>Unique registered athletes</span>
        </div>
        <div>
          <strong>{returning}</strong>
          <span>Athletes registered in multiple events</span>
        </div>
      </div>
      <p>
        Attendance counts distinct registration/session placements with an active check-in.
        Completion counts recorded scorecards; use each event’s coverage report to review expected
        work and current assignments.
      </p>
      <div className="talent-table">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Registrations</th>
              <th>Arrived / scheduled placements</th>
              <th>Completed / recorded scorecards</th>
            </tr>
          </thead>
          <tbody>
            {events.data?.map((t) => {
              const arrived = checkins.data?.find((r) => r.tryout_id === t.id)?.placements ?? 0;
              const scheduled = new Set(
                enrollments.data
                  ?.filter((r) => r.tryout_id === t.id)
                  .map((r) => `${r.registration_id}:${r.session_id}`),
              );
              const cards = evaluations.data?.filter((r) => r.tryout_id === t.id) ?? [];
              return (
                <tr key={t.id}>
                  <th>
                    <Link href={`/app/${slug}/tryouts/${t.id}/reports/decision-packet`}>
                      {t.name}
                    </Link>
                    <br />
                    <small>Created {t.created_at.slice(0, 10)}</small>
                  </th>
                  <td>{registrations.data?.filter((r) => r.tryout_id === t.id).length}</td>
                  <td>
                    {arrived} / {scheduled.size}
                  </td>
                  <td>
                    {cards.filter((r) => ['completed', 'locked'].includes(r.state)).length} /{' '}
                    {cards.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section>
        <h2>Current prospect pipeline</h2>
        <div className="talent-stats">
          {[...new Set(profiles.data?.map((p) => p.stage))].map((stage) => (
            <div key={stage}>
              <strong>{profiles.data?.filter((p) => p.stage === stage).length}</strong>
              <span>{stage.replaceAll('_', ' ')}</span>
            </div>
          ))}
        </div>
        <p>
          Pipeline counts show the current stage. Longitudinal measurement history is available in
          each athlete’s Stats tab, preserving protocols, sources and dates.
        </p>
        <Link className="talent-no-print" href={`/app/${slug}/performance`}>
          Compare a performance cohort
        </Link>
      </section>
    </article>
  );
}
