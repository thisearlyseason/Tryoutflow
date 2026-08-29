'use client';

import { useId } from 'react';

export type ScoreChange = { categoryId: string; score: number };

export function ScoreControl({
  categoryId,
  disabled = false,
  error,
  label,
  max,
  min,
  onChange,
  value,
}: {
  categoryId: string;
  disabled?: boolean;
  error?: string;
  label: string;
  max: 5 | 10;
  min: 1;
  onChange: (change: ScoreChange) => void;
  value: number | null;
}) {
  const id = useId();
  const scores = Array.from({ length: max - min + 1 }, (_, index) => index + min);
  const errorId = `${id}-error`;

  function choose(score: number) {
    if (!disabled) onChange({ categoryId, score });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const target = event.target as HTMLInputElement;
    const current = Number(target.value || value || min);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = current >= max ? min : current + 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = current <= min ? max : current - 1;
    } else if (/^[1-9]$/u.test(event.key)) {
      next = Number(event.key);
    } else if (event.key === '0' && max === 10) {
      next = 10;
    }
    if (next === null || next < min || next > max) return;
    event.preventDefault();
    choose(next);
    document.getElementById(`${id}-${next}`)?.focus();
  }

  return (
    <div
      aria-describedby={error ? errorId : undefined}
      aria-label={`${label} score`}
      aria-orientation="horizontal"
      className={`grid min-w-0 grid-cols-5 gap-2 rounded-xl border p-2 ${
        error ? 'border-[var(--color-destructive)]' : 'border-[var(--color-border)]'
      }`}
      id={`score-group-${categoryId}`}
      onKeyDown={handleKeyDown}
      role="radiogroup"
      tabIndex={-1}
    >
      {scores.map((score) => {
        const selected = value === score;
        return (
          <label
            className={`relative grid min-h-[44px] min-w-0 cursor-pointer place-items-center overflow-hidden rounded-lg border font-[var(--font-score)] text-lg font-bold focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[var(--color-focus)] ${
              selected
                ? 'border-[var(--color-text)] bg-[var(--color-performance)] text-[var(--color-performance-foreground)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)]'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            key={score}
          >
            <input
              aria-label={`${label} score ${score} of ${max}`}
              checked={selected}
              className="absolute inset-0 min-h-[44px] min-w-[44px] cursor-inherit appearance-none rounded-lg"
              disabled={disabled}
              id={`${id}-${score}`}
              name={`${id}-score`}
              onChange={() => choose(score)}
              type="radio"
              value={score}
            />
            <span aria-hidden="true">{score}</span>
            {selected ? <span className="sr-only">Selected</span> : null}
          </label>
        );
      })}
      {error ? (
        <p
          className="col-span-5 text-sm font-bold text-[var(--color-destructive)]"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
