export default function RankingsLoading() {
  return (
    <section aria-busy="true" aria-live="polite">
      <p className="eyebrow">Decision evidence</p>
      <h2>Loading rankings…</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Loading the latest authorized evaluation snapshot.
      </p>
    </section>
  );
}
