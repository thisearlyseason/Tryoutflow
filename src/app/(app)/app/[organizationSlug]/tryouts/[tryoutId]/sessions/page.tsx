import Link from 'next/link';
import { EmptyState } from '@/components/feedback/empty-state';
import { ErrorState } from '@/components/feedback/error-state';

import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { TryoutJourneyNavigation } from '@/modules/tryouts/ui/tryout-journey';

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default async function TryoutSessionsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const journeyNavigation = (ready = false) => (
    <TryoutJourneyNavigation
      nextAction={
        ready
          ? {
              label: 'Open check-in',
              href: `/app/${organizationSlug}/tryouts/${tryoutId}/check-in`,
            }
          : undefined
      }
      overviewHref={`/app/${organizationSlug}/tryouts/${tryoutId}/overview`}
    />
  );
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:read', {
      organizationId: current.organization.id,
      tryoutId,
    }).ok
  )
    return (
      <section aria-labelledby="sessions-denied">
        <h1 id="sessions-denied">Sessions unavailable</h1>
        <p role="alert">You do not have access to this tryout.</p>
      </section>
    );

  const [tryoutResult, sessionsResult] = await Promise.all([
    current.client
      .from('tryouts')
      .select('id,name,status')
      .eq('organization_id', current.organization.id)
      .eq('id', tryoutId)
      .maybeSingle(),
    current.client
      .from('tryout_sessions')
      .select(
        'id,name,starts_at,ends_at,location,capacity,tryout_divisions!tryout_sessions_division_fkey(name),session_groups!session_groups_session_fkey(id,name,capacity)',
      )
      .eq('organization_id', current.organization.id)
      .eq('tryout_id', tryoutId)
      .order('starts_at'),
  ]);

  if (tryoutResult.error || sessionsResult.error || sessionsResult.data === null) {
    captureOperationalError(
      tryoutResult.error ?? sessionsResult.error ?? new Error('Session data unavailable'),
      {
        actorId: current.userId,
        organizationId: current.organization.id,
        tryoutId,
        operation: 'tryouts.load',
      },
    );
    return (
      <section aria-labelledby="sessions-unavailable">
        {journeyNavigation()}
        <h1 id="sessions-unavailable">Sessions temporarily unavailable</h1>
        <ErrorState
          title="Could not load session details"
          description="Try loading the schedule again or return to the tryout overview."
          action={
            <a
              className="button-secondary inline-flex min-h-11 items-center"
              href={`/app/${organizationSlug}/tryouts/${tryoutId}/sessions`}
            >
              Retry sessions
            </a>
          }
        />
      </section>
    );
  }
  if (!tryoutResult.data)
    return (
      <section aria-labelledby="sessions-not-found">
        <h1 id="sessions-not-found">Tryout not found</h1>
        <p>The tryout may have been removed or is outside your assigned scope.</p>
        <Link
          className="button-secondary mt-4 inline-flex min-h-11 items-center"
          href={`/app/${organizationSlug}/tryouts`}
          prefetch={false}
        >
          Back to tryouts
        </Link>
      </section>
    );

  const hasSessions = Boolean(sessionsResult.data?.length);
  const canSetup =
    tryoutResult.data.status === 'draft' &&
    requireCapability(current.authorization, 'tryout:write', {
      organizationId: current.organization.id,
      tryoutId,
    }).ok;
  return (
    <section aria-labelledby="sessions-heading" className="min-w-0">
      {journeyNavigation(hasSessions)}
      <p className="eyebrow">Tryout schedule</p>
      <h1 id="sessions-heading">{tryoutResult.data.name} sessions</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Review the session, division, location, capacity, and group configuration used for check-in
        and evaluations.
      </p>
      {sessionsResult.data?.length ? (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2">
          {sessionsResult.data.map((session) => (
            <li className="card min-w-0 p-5" key={session.id}>
              <h3>{session.name}</h3>
              <dl className="mt-3 grid gap-2 text-sm">
                <div>
                  <dt className="font-semibold">Division</dt>
                  <dd>{session.tryout_divisions.name}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Time</dt>
                  <dd>
                    {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Location</dt>
                  <dd>{session.location || 'Not specified'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Capacity</dt>
                  <dd>{session.capacity ?? 'No session limit'}</dd>
                </div>
              </dl>
              {session.session_groups.length ? (
                <div className="mt-4">
                  <h4 className="font-semibold">Groups</h4>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {session.session_groups.map((group) => (
                      <li className="rounded-full border px-3 py-1 text-sm" key={group.id}>
                        {group.name} · {group.capacity ?? 'no limit'}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--color-text-muted)]">No groups configured.</p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6">
          <EmptyState
            title={canSetup ? 'No sessions yet' : 'No sessions available'}
            description={
              canSetup
                ? 'Add a session with its division, dates and location before moving on to check-in.'
                : 'There are no sessions to show for this tryout. Ask an owner or event director to check the schedule.'
            }
            action={
              canSetup ? (
                <Link
                  className="button-primary inline-flex min-h-11 items-center"
                  href={`/app/${organizationSlug}/tryouts/${tryoutId}/setup/sessions`}
                  prefetch={false}
                >
                  Add sessions
                </Link>
              ) : undefined
            }
          />
        </div>
      )}
    </section>
  );
}

export const metadata = { title: 'Tryout sessions | TryoutFlow' };
