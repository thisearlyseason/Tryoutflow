import { AthletePager } from '../../../../../src/modules/evaluations/ui/athlete-pager';
import { EvaluationForm } from '../../../../../src/modules/evaluations/ui/evaluation-form';

const athletes = [
  {
    registrationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    displayName: 'Athlete A1B2C3',
    tryoutNumber: 42,
  },
  {
    registrationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    displayName: 'Athlete D4E5F6',
    tryoutNumber: 43,
  },
  {
    registrationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    displayName: 'Athlete G7H8J9',
    tryoutNumber: 44,
  },
];

const categories = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Skating',
    description: 'Balance and edge control',
    guidance: 'Look for control through direction changes.',
    scaleMin: 1 as const,
    scaleMax: 5 as const,
    required: true,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Compete',
    description: 'Effort and response under pressure',
    guidance: 'Use the full scale and score only what you observe.',
    scaleMin: 1 as const,
    scaleMax: 5 as const,
    required: true,
  },
];

export default async function EvaluationFixturePage({
  params,
}: {
  params: Promise<{ registrationId: string }>;
}) {
  const { registrationId } = await params;
  const index = athletes.findIndex((athlete) => athlete.registrationId === registrationId);
  const athlete = athletes[index] ?? athletes[0]!;
  const previous = athletes[index - 1];
  const next = athletes[index + 1];

  async function onSave(input: { note?: string; expectedVersion: number }) {
    'use server';
    if (
      registrationId === athletes[1]?.registrationId &&
      input.note?.includes('trigger conflict')
    ) {
      return { outcome: 'conflict' as const };
    }
    return {
      outcome: 'saved' as const,
      evaluationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      version: input.expectedVersion + 1,
    };
  }

  async function onComplete(input: { expectedVersion: number }) {
    'use server';
    return { outcome: 'completed' as const, version: input.expectedVersion + 1 };
  }

  return (
    <main className="mx-auto grid min-h-dvh min-w-0 max-w-3xl gap-5 overflow-x-clip px-4 py-5">
      <AthletePager
        currentIndex={index}
        nextHref={next ? `/${next.registrationId}` : null}
        previousHref={previous ? `/${previous.registrationId}` : null}
        total={athletes.length}
      />
      <EvaluationForm
        athlete={{
          ...athlete,
          identityMode: 'blind',
          divisionName: 'U13',
          sessionName: 'Morning skills',
          groupName: 'Blue',
        }}
        categories={categories}
        draftCacheKey={`fixture:${registrationId}`}
        initialDraft={{ evaluationId: null, version: 0, state: 'draft', scores: [] }}
        noteTags={[
          { id: '11111111-1111-4111-8111-111111111111', label: 'Quick feet' },
          { id: '22222222-2222-4222-8222-222222222222', label: 'Good awareness' },
        ]}
        onComplete={onComplete}
        onSave={onSave}
      />
      <AthletePager
        currentIndex={index}
        nextHref={next ? `/${next.registrationId}` : null}
        previousHref={previous ? `/${previous.registrationId}` : null}
        total={athletes.length}
      />
    </main>
  );
}
