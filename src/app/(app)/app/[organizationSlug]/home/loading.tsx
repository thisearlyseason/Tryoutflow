export default function WorkspaceLoading() {
  return (
    <section
      aria-label="Loading workspace"
      role="status"
      className="workspace-stack loading-skeleton"
    >
      <span className="sr-only">Loading workspace…</span>
      <div aria-hidden="true" className="skeleton-heading" />
      <div aria-hidden="true" className="metric-grid">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="card skeleton-metric" />
        ))}
      </div>
      <div aria-hidden="true" className="card skeleton-panel">
        {[0, 1, 2, 3, 4].map((item) => (
          <div key={item} className="skeleton-row" />
        ))}
      </div>
    </section>
  );
}
