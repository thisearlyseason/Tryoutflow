'use client';

import { useState } from 'react';
import { AthleteRadarChart } from '../../evaluations/ui/athlete-radar-chart';
import type { AthleteComparison } from '../application/compare-athletes';

export function AthleteComparisonRadar({ athletes }: { athletes: AthleteComparison['athletes'] }) {
  const [firstId, setFirstId] = useState(athletes[0]?.athleteId);
  const [secondId, setSecondId] = useState(athletes[1]?.athleteId);
  const first = athletes.find((athlete) => athlete.athleteId === firstId) ?? athletes[0];
  const second =
    athletes.find(
      (athlete) => athlete.athleteId === secondId && athlete.athleteId !== first?.athleteId,
    ) ?? athletes.find((athlete) => athlete.athleteId !== first?.athleteId);
  if (!first || !second) return null;
  // Category IDs are immutable rubric-version IDs. Never align axes by label.
  const shared = first.categories.filter((category) =>
    second.categories.some((other) => other.categoryId === category.categoryId),
  );
  return (
    <section
      aria-label="Athlete Profile comparison"
      className="mb-5 rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6"
    >
      <h3>Athlete Profile comparison</h3>
      <p className="my-2 text-sm text-[var(--color-text-muted)]">
        Completed evaluation averages on a 100-point scale. Only matching criterion IDs from the
        same form version are overlaid.
      </p>
      {athletes.length > 2 && (
        <div className="my-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-bold">
            First athlete
            <select
              className="min-h-11 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
              value={first.athleteId}
              onChange={(event) => setFirstId(event.target.value)}
            >
              {athletes.map((athlete) => (
                <option key={athlete.athleteId} value={athlete.athleteId}>
                  {athlete.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-bold">
            Second athlete
            <select
              className="min-h-11 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
              value={second.athleteId}
              onChange={(event) => setSecondId(event.target.value)}
            >
              {athletes
                .filter((athlete) => athlete.athleteId !== first.athleteId)
                .map((athlete) => (
                  <option key={athlete.athleteId} value={athlete.athleteId}>
                    {athlete.displayName}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
      {shared.length < 3 ? (
        <p className="py-4 text-sm">
          At least 3 scored criteria from the same form version must match to compare these
          athletes.
        </p>
      ) : (
        <div className="mx-auto max-w-2xl">
          <AthleteRadarChart
            criteria={shared.map((category) => ({ id: category.categoryId, name: category.name }))}
            scores={shared.map((category) => ({
              categoryId: category.categoryId,
              value: Number(category.normalizedAverage),
            }))}
            comparisonScores={second.categories
              .filter((category) => shared.some((item) => item.categoryId === category.categoryId))
              .map((category) => ({
                categoryId: category.categoryId,
                value: Number(category.normalizedAverage),
              }))}
            scale={{ min: 0, max: 100 }}
            athleteName={first.displayName}
            comparisonName={second.displayName}
          />
        </div>
      )}
    </section>
  );
}
