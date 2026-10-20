export default function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite" className="workspace-card p-6">
      <span aria-hidden="true" className="action-spinner" />
      Loading workspace…
    </div>
  );
}
