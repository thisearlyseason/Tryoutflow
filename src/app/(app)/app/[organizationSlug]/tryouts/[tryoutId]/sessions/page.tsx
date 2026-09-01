import Link from 'next/link';

import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { requireCapability } from '@/modules/organizations/application/require-capability';

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
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:read', {
      organizationId: current.organization.id,
      tryoutId,
    }).ok
  )
    return (
      <section aria-labelledby="sessions-denied">
        <h2 id="sessions-denied">Sessions unavailable</h2>
        <p role="alert">You do not have access to this tryout.</p>
      </section>
    );

  const [tryoutResult, sessionsResult] = await Promise.all([
    current.client
      .from('tryouts')
      .select('id,name')
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

  if (tryoutResult.error || sessionsResult.error) {
    captureOperationalError(tryoutResult.error ?? sessionsResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId,
      operation: 'tryouts.load',
    });
    return (
      <section aria-labelledby="sessions-unavailable">
        <h2 id="sessions-unavailable">Sessions temporarily unavailable</h2>
        <p role="alert">Session details could not be loaded. Refresh or try again shortly.</p>
      </section>
    );
  }
  if (!tryoutResult.data)
    return (
      <section aria-labelledby="sessions-not-found">
        <h2 id="sessions-not-found">Tryout not found</h2>
        <p>The tryout may have been removed or is outside your assigned scope.</p>
      </section>
    );

  return (
    <section aria-labelledby="sessions-heading" className="min-w-0">
      <p className="eyebrow">Tryout schedule</p>
      <h2 id="sessions-heading">{tryoutResult.data.name} sessions</h2>
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
        <div className="card mt-6 p-5">
          <h3>No sessions configured</h3>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Complete the guided setup before publishing this tryout.
          </p>
          <Link
            className="button-secondary mt-4 inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/${tryoutId}/setup/sessions`}
            prefetch={false}
          >
            Open tryout setup
          </Link>
        </div>
      )}
    </section>
  );
}
