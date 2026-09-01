export function BibBadge({ number }: { number: number | string | null }) {
  const label = number === null ? 'No tryout number' : `Tryout number ${number}`;
  return (
    <span
      aria-label={label}
      className="inline-grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--color-text)] font-[family-name:var(--font-bib)] text-sm text-[var(--color-text-inverted)]"
    >
      {number ?? '—'}
    </span>
  );
}
