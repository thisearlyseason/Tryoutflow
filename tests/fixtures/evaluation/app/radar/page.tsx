'use client';

import { EvaluationForm } from '../../../../../src/modules/evaluations/ui/evaluation-form';
import { AthleteRadarChart } from '../../../../../src/modules/evaluations/ui/athlete-radar-chart';
const categories = [
  'Speed',
  'Ball Handling',
  'Shooting',
  'Passing',
  'Defense',
  'Basketball IQ',
].map((name, index) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
  name,
  scaleMin: 1 as const,
  scaleMax: 10 as const,
  weight: index === 0 ? '20' : '16',
  required: true,
  description: null,
  guidance: null,
}));
export default function RadarFixture() {
  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1>Athlete Profile preview</h1>
      <EvaluationForm
        athlete={{
          registrationId: 'preview',
          displayName: 'Jordan Lee',
          identityMode: 'full',
          tryoutNumber: 24,
          divisionName: 'U18',
          sessionName: 'Basketball skills',
          groupName: null,
        }}
        categories={categories}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [] }}
        onSave={async (input) => ({
          outcome: 'saved',
          evaluationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          version: input.expectedVersion + 1,
        })}
        onComplete={async (input) => ({ outcome: 'completed', version: input.expectedVersion + 1 })}
        loadAverage={async () => ({
          evaluationCount: 2,
          scores: categories.map((category, index) => ({
            categoryId: category.id,
            value: 6 + index / 2,
            count: 2,
          })),
        })}
      />
      <section className="my-6 rounded-lg border border-[var(--color-border)] p-4">
        <h2>Comparison preview</h2>
        <AthleteRadarChart
          criteria={categories}
          scores={categories
            .slice(0, 5)
            .map((category, index) => ({ categoryId: category.id, value: 9 - index }))}
          comparisonScores={categories
            .slice(1)
            .map((category, index) => ({ categoryId: category.id, value: 5 + index }))}
          athleteName="Jordan Lee"
          comparisonName="Alex Smith"
        />
      </section>
    </main>
  );
}
