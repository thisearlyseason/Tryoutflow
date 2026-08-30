type IntegrationCardProps = Readonly<{
  providerName: string;
  enabled: boolean;
  connected?: boolean;
  connectionLabel?: string;
  connectAction?: () => Promise<void>;
}>;

export function IntegrationCard({
  providerName,
  enabled,
  connected = false,
  connectionLabel,
  connectAction,
}: IntegrationCardProps) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
            Team management
          </p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">{providerName}</h2>
        </div>
        <span className="rounded-full bg-lime-100 px-3 py-1 text-sm font-bold text-lime-950">
          Demo/mock only
        </span>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700">
        Synthetic demonstration data only. No provider credentials or production endpoint are
        configured.
      </p>
      {!enabled ? (
        <p className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950">
          Disabled by default. An administrator must enable the server-side demo flag.
        </p>
      ) : connected ? (
        <p className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-semibold text-emerald-950">
          Connected to {connectionLabel ?? providerName} for this administrator’s demo session.
        </p>
      ) : connectAction ? (
        <form action={connectAction} className="mt-5">
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Connect demo provider
          </button>
        </form>
      ) : null}
    </article>
  );
}
