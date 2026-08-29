export default function LiveDashboardLoading() {
  return (
    <section aria-busy="true" aria-live="polite">
      <p className="eyebrow">Operational snapshot</p>
      <h2>Loading live dashboard…</h2>
    </section>
  );
}
