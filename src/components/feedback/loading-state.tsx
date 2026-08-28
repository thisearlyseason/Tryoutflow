export type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = 'Loading' }: LoadingStateProps) {
  return (
    <div
      aria-label={label}
      className="flex min-h-[var(--target-mobile)] items-center gap-2 text-sm text-[var(--color-text-muted)]"
      role="status"
    >
      <span
        aria-hidden="true"
        className="size-3 animate-pulse rounded-full bg-[var(--color-primary)]"
      />
      <span>{label}</span>
    </div>
  );
}
