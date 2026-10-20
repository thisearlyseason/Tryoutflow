import Link from 'next/link';
import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { DuplicateTryoutButton } from './duplicate-tryout-button';

import { StatusBadge } from '../../../components/ui/status-badge';

type TryoutCardStatus = 'draft' | 'published' | 'finalized' | 'unavailable';

const statusCopy: Record<TryoutCardStatus, string> = {
  draft: 'Setup is incomplete',
  published: 'Manage registration and tryout operations',
  finalized: 'Final roster is preserved',
  unavailable: 'Tryout details are temporarily unavailable',
};

export function TryoutCard({
  baseHref,
  name,
  status,
  updatedAt,
  sport,
  management,
}: {
  baseHref: string;
  name: string;
  status: TryoutCardStatus;
  updatedAt: string;
  sport?: string;
  management?: { organizationSlug: string; tryoutId: string };
}) {
  const primaryHref =
    status === 'draft'
      ? `${baseHref}/setup/basics`
      : status === 'published' || status === 'finalized'
        ? `${baseHref}/overview`
        : null;
  const primaryLabel = status === 'draft' ? 'Continue setup' : 'Open tryout';
  return (
    <article className="tryout-card" data-status={status}>
      <div className="tryout-card-status">
        <StatusBadge status={status}>{status}</StatusBadge>
        <time dateTime={updatedAt}>
          <CalendarDays size={13} aria-hidden="true" />
          Updated{' '}
          {new Intl.DateTimeFormat('en', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(updatedAt))}
        </time>
      </div>
      <div>
        {sport && <span className="tryout-sport-label">{sport.replaceAll('_', ' ')}</span>}
        <h2>{name}</h2>
        <p>{statusCopy[status]}</p>
      </div>
      <div className="tryout-card-actions">
        {primaryHref ? (
          <Link className="button-primary" href={primaryHref} prefetch={false}>
            {primaryLabel} <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        ) : null}
        {status === 'published' || status === 'finalized' ? (
          <Link
            className="button-secondary"
            href={`${baseHref}/registration#add-participant`}
            prefetch={false}
          >
            Add participants
          </Link>
        ) : null}
        {management && status !== 'unavailable' ? (
          <>
            <Link className="button-secondary" href={`${baseHref}/setup/basics`} prefetch={false}>
              Edit setup
            </Link>
            <DuplicateTryoutButton {...management} />
          </>
        ) : null}
      </div>
    </article>
  );
}
