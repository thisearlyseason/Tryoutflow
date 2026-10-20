'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function SuggestionInput({
  name,
  disabled = false,
  initialValues,
  options,
}: {
  name: string;
  disabled?: boolean;
  initialValues: string[];
  options: string[];
}) {
  const [value, setValue] = useState(initialValues.join(', '));
  const selected = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    <div className="grid gap-3">
      <Input
        disabled={disabled}
        id={name}
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <p className="text-sm text-[var(--color-text-muted)]">
        Choose suggestions below, or type your own separated by commas.
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Suggested values">
        {options.map((option) => {
          const active = selected.some((item) => item.toLowerCase() === option.toLowerCase());
          return (
            <Button
              disabled={disabled}
              key={option}
              variant={active ? 'primary' : 'secondary'}
              aria-pressed={active}
              onClick={() =>
                setValue(
                  (active
                    ? selected.filter((item) => item.toLowerCase() !== option.toLowerCase())
                    : [...selected, option]
                  ).join(', '),
                )
              }
            >
              {option}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
