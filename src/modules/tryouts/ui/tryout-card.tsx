import Link from 'next/link';

import { StatusBadge } from '../../../components/ui/status-badge';

type TryoutCardStatus = 'draft' | 'published' | 'finalized' | 'unavailable';

const statusCopy: Record<TryoutCardStatus, string> = {
  draft: 'Setup is incomplete',
  published: 'Participant intake is open',
  finalized: 'Final roster is preserved',
  unavailable: 'Tryout details are temporarily unavailable',
};

export function TryoutCard({
  baseHref,
  name,
  status,
  updatedAt,
}: {
  baseHref: string;
  name: string;
  status: TryoutCardStatus;
  updatedAt: string;
}) {
  const primaryHref =
    status === 'draft'
      ? `${baseHref}/setup/basics`
      : status === 'published' || status === 'finalized'
        ? `${baseHref}/overview`
        : null;
  const primaryLabel = status === 'draft' ? 'Continue setup' : 'Open tryout';
  return (
    <article className="tryout-card">
      <div className="tryout-card-status">
        <StatusBadge status={status}>{status}</StatusBadge>
        <time dateTime={updatedAt}>Recently updated</time>
      </div>
      <div>
        <h2>{name}</h2>
        <p>{statusCopy[status]}</p>
      </div>
      <div className="tryout-card-actions">
        {primaryHref ? (
          <Link className="button-primary" href={primaryHref} prefetch={false}>
            {primaryLabel}
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
      </div>
    </article>
  );
}
