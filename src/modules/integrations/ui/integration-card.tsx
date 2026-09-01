type IntegrationCardProps = Readonly<{
  providerName: string;
  enabled: boolean;
  connected?: boolean;
  connectionLabel?: string;
  connectAction?: () => Promise<void>;
  notice?: string;
}>;

export function IntegrationCard({
  providerName,
  enabled,
  connected = false,
  connectionLabel,
  connectAction,
  notice,
}: IntegrationCardProps) {
  return (
    <article className="integration-card rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Team management</p>
          <h2 className="mt-2 text-2xl font-black">{providerName}</h2>
        </div>
        <StatusBadge data-status="warning" status="warning">
          Demo/mock only
        </StatusBadge>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">
        Synthetic demonstration data only. No provider credentials or production endpoint are
        configured.
      </p>
      {notice ? (
        <p
          role="alert"
          className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-warning)] bg-[var(--color-warning-surface)] p-4 font-semibold text-[var(--color-warning)]"
        >
          {notice}
        </p>
      ) : null}
      {!enabled ? (
        <p className="mt-5 rounded-[var(--radius-control)] border border-[var(--color-warning)] bg-[var(--color-warning-surface)] p-4 font-semibold text-[var(--color-warning)]">
          Disabled by default. An administrator must enable the server-side demo flag.
        </p>
      ) : connected ? (
        <p className="mt-5 rounded-[var(--radius-control)] border border-[var(--color-success)] bg-[var(--color-success-surface)] p-4 font-semibold text-[var(--color-success)]">
          Connected to {connectionLabel ?? providerName} for this administrator’s demo session.
        </p>
      ) : connectAction ? (
        <form action={connectAction} className="mt-5">
          <Button type="submit">Connect demo provider</Button>
        </form>
      ) : null}
    </article>
  );
}
import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/ui/status-badge';
