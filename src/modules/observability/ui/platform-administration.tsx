import Link from 'next/link';

import type { DetailedHealth } from '../application/health-check';

export type PlatformOrganization = Readonly<{
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}>;

export type PlatformSubscription = Readonly<{
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  plan: string;
  state: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  verifiedAt: string | null;
}>;

export type VisibleAuditEvent = Readonly<{
  id: string;
  organizationId: string;
  organizationSlug?: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
}>;

export type VisibleSupportElevation = Readonly<{
  id: string;
  organizationId: string;
  organizationSlug: string;
  supportUserId: string;
  reason: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}>;

const card =
  'min-w-0 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-surface)]';

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString('en-CA')}</time>;
}

export function PlatformNavigation() {
  const links = [
    ['Organizations', '/platform/organizations'],
    ['Subscriptions', '/platform/subscriptions'],
    ['System health', '/platform/health'],
    ['Support', '/platform/support'],
    ['Audit', '/platform/audit'],
  ] as const;
  return (
    <nav
      aria-label="Platform administration"
      className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      {links.map(([label, href]) => (
        <Link className="inline-flex min-h-11 items-center" href={href} key={href} prefetch={false}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function OrganizationDirectory({
  organizations,
}: {
  organizations: readonly PlatformOrganization[];
}) {
  if (organizations.length === 0) return <p role="status">No organizations found.</p>;
  return (
    <ul aria-label="Organizations" className="grid gap-4 md:grid-cols-2">
      {organizations.map((organization) => (
        <li className={card} key={organization.id}>
          <h2 className="text-xl font-black">{organization.name}</h2>
          <p className="break-all text-sm text-[var(--color-text-muted)]">{organization.slug}</p>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt>Status</dt>
            <dd>{organization.status}</dd>
            <dt>Created</dt>
            <dd>
              <Timestamp value={organization.createdAt} />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function SubscriptionDirectory({
  subscriptions,
}: {
  subscriptions: readonly PlatformSubscription[];
}) {
  if (subscriptions.length === 0) return <p role="status">No subscriptions found.</p>;
  return (
    <ul aria-label="Subscriptions" className="grid gap-4 md:grid-cols-2">
      {subscriptions.map((subscription) => (
        <li className={card} key={subscription.organizationId}>
          <h2 className="text-xl font-black">{subscription.organizationName}</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{subscription.organizationSlug}</p>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt>Plan</dt>
            <dd>{subscription.plan}</dd>
            <dt>State</dt>
            <dd>{subscription.state}</dd>
            <dt>Renews</dt>
            <dd>
              {subscription.currentPeriodEnd ? (
                <Timestamp value={subscription.currentPeriodEnd} />
              ) : (
                'Not scheduled'
              )}
            </dd>
            <dt>Cancellation</dt>
            <dd>
              {subscription.cancelAtPeriodEnd ? 'Ends after current period' : 'Not scheduled'}
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function HealthMetrics({ health }: { health: DetailedHealth }) {
  const metrics = [
    ['Database', health.database],
    ['Failed jobs', health.failedJobs],
    ['Webhook failures', health.webhookFailures],
    ['Communication failures', health.communicationFailures],
    ['Integration failures', health.integrationFailures],
    ['Synchronization problems', health.synchronizationProblems],
  ] as const;
  return (
    <dl aria-label="System health" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map(([label, value]) => (
        <div className={card} key={label}>
          <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
          <dd className="mt-1 text-3xl font-black">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditEventList({ events }: { events: readonly VisibleAuditEvent[] }) {
  if (events.length === 0) return <p role="status">No audit events found.</p>;
  return (
    <ol aria-label="Audit events" className="grid gap-3">
      {events.map((event) => (
        <li className={card} key={event.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="break-all font-black">{event.action}</h3>
            <Timestamp value={event.occurredAt} />
          </div>
          <p className="mt-2 break-all text-sm text-[var(--color-text-muted)]">
            {event.organizationSlug ? `${event.organizationSlug} · ` : ''}
            {event.entityType} · {event.entityId}
          </p>
          <p className="mt-1 break-all text-sm">Actor: {event.actorId ?? 'System'}</p>
        </li>
      ))}
    </ol>
  );
}

export function SupportElevationList({
  elevations,
}: {
  elevations: readonly VisibleSupportElevation[];
}) {
  if (elevations.length === 0) return <p role="status">No support elevations found.</p>;
  return (
    <ol aria-label="Support elevations" className="grid gap-3">
      {elevations.map((elevation) => (
        <li className={card} key={elevation.id}>
          <h3 className="break-all font-black">{elevation.organizationSlug}</h3>
          <p className="mt-2 break-words">{elevation.reason}</p>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
            <dt>Support actor</dt>
            <dd className="break-all">{elevation.supportUserId}</dd>
            <dt>Expires</dt>
            <dd>
              <Timestamp value={elevation.expiresAt} />
            </dd>
            <dt>Status</dt>
            <dd>{elevation.revokedAt ? 'Revoked' : 'Time-bound'}</dd>
          </dl>
        </li>
      ))}
    </ol>
  );
}
