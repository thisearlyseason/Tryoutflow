import { ArrowRight, CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { StatusBadge } from '../../../components/ui/status-badge';

export type DashboardActivityData = {
  tryouts: { id: string; name: string; status: string; updated_at: string }[] | null;
  athletes: { id: string; given_name: string; family_name: string; created_at: string }[] | null;
};

export function DashboardActivity({
  data,
  organizationSlug,
}: {
  data: DashboardActivityData;
  organizationSlug: string;
}) {
  const base = `/app/${organizationSlug}`;
  return (
    <>
      <section className="card dashboard-activity" aria-labelledby="recent-tryouts-heading">
        <header>
          <h2 id="recent-tryouts-heading">Recent tryouts</h2>
          <Link href={`${base}/tryouts`} prefetch={false}>
            View all <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </header>
        {data.tryouts === null ? (
          <p>Tryouts are temporarily unavailable. Open Tryouts to try again.</p>
        ) : data.tryouts.length === 0 ? (
          <p>No tryouts yet. Create your first tryout to get started.</p>
        ) : (
          <ul>
            {data.tryouts.map((tryout) => (
              <li key={tryout.id}>
                <span className="activity-icon" aria-hidden="true">
                  <CalendarDays size={19} />
                </span>
                <div>
                  <Link href={`${base}/tryouts/${tryout.id}/overview`} prefetch={false}>
                    {tryout.name}
                  </Link>
                  <small>
                    Updated{' '}
                    {new Date(tryout.updated_at).toLocaleDateString('en-CA', {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </small>
                </div>
                <StatusBadge
                  status={
                    tryout.status === 'draft' ||
                    tryout.status === 'published' ||
                    tryout.status === 'finalized'
                      ? tryout.status
                      : 'unavailable'
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card dashboard-activity" aria-labelledby="recent-athletes-heading">
        <header>
          <h2 id="recent-athletes-heading">Recently added athletes</h2>
          <Link href={`${base}/athletes`} prefetch={false}>
            View all <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </header>
        {data.athletes === null ? (
          <p>Athletes are temporarily unavailable. Open Athletes to try again.</p>
        ) : data.athletes.length === 0 ? (
          <p>New athletes will appear here as your program grows.</p>
        ) : (
          <ul>
            {data.athletes.map((athlete) => (
              <li key={athlete.id}>
                <span className="athlete-avatar" aria-hidden="true">
                  {athlete.given_name[0]}
                  {athlete.family_name[0]}
                </span>
                <div>
                  <Link href={`${base}/athletes/${athlete.id}`} prefetch={false}>
                    {athlete.given_name} {athlete.family_name}
                  </Link>
                  <small>
                    Added{' '}
                    {new Date(athlete.created_at).toLocaleDateString('en-CA', {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </small>
                </div>
                <ArrowRight size={14} aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
