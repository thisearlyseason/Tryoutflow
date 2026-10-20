export function LegalDraftStatus() {
  return (
    <aside className="mt-7 max-w-4xl rounded-[var(--radius-surface)] border-2 border-[var(--color-selection)] bg-[var(--color-surface)] p-5">
      <div role="status">
        <p className="font-black">Prelaunch draft — legal review and approval required</p>
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
          This working draft is not legal advice and is not approved for production use. Unresolved
          items are visibly marked and must be closed before launch.
        </p>
      </div>
    </aside>
  );
}
