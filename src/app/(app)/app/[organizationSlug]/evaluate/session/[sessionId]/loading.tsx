export default function EvaluatorSessionLoading() {
  return (
    <section aria-busy="true" aria-labelledby="evaluation-loading-heading" className="grid gap-4">
      <p className="eyebrow">Evaluator workspace</p>
      <h2 id="evaluation-loading-heading">Loading assigned athletes…</h2>
      <div className="h-28 animate-pulse rounded-xl bg-[var(--color-surface-muted)] motion-reduce:animate-none" />
      <p className="text-sm text-[var(--color-text-muted)]" role="status">
        Loading your session and rubric.
      </p>
    </section>
  );
}
