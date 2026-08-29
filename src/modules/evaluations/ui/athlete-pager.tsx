import Link from 'next/link';

const disabledClass =
  'min-h-[44px] rounded-lg border border-[var(--color-border)] px-4 py-3 text-center font-bold text-[var(--color-text-muted)] opacity-50';
const linkClass =
  'min-h-[44px] rounded-lg border border-[var(--color-primary)] px-4 py-3 text-center font-bold text-[var(--color-primary)] focus:outline-3 focus:outline-offset-2 focus:outline-[var(--color-focus)]';

export function AthletePager({
  currentIndex,
  nextHref,
  previousHref,
  total,
}: {
  currentIndex: number;
  nextHref: string | null;
  previousHref: string | null;
  total: number;
}) {
  return (
    <nav
      aria-label="Athlete navigation"
      className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-2"
    >
      {previousHref ? (
        <Link className={linkClass} href={previousHref} prefetch>
          Previous athlete
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          Previous
        </span>
      )}
      <span className="whitespace-nowrap px-1 text-center text-sm font-bold tabular-nums">
        {currentIndex + 1} of {total}
      </span>
      {nextHref ? (
        <Link className={linkClass} href={nextHref} prefetch>
          Next athlete
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          Next
        </span>
      )}
    </nav>
  );
}
