import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';

import { AthletePager } from '../../../../../src/modules/evaluations/ui/athlete-pager';
import { EvaluationForm } from '../../../../../src/modules/evaluations/ui/evaluation-form';
import { SynchronizedEvaluationForm } from '../../../../../src/modules/evaluations/ui/synchronized-evaluation-form';
import { readAuthoritativeEvaluationId } from '../../lib/authoritative-evaluation-state';

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
  {
    registrationId: 'abababab-abab-4bab-8bab-abababababab',
    displayName: 'Athlete K1L2M3',
    tryoutNumber: 45,
  },
  {
    registrationId: 'acacacac-acac-4cac-8cac-acacacacacac',
    displayName: 'Athlete N4P5Q6',
    tryoutNumber: 46,
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
  const engine = (await headers()).get('user-agent')?.includes('Chrome') ? 'chromium' : 'webkit';
  const index = athletes.findIndex((athlete) => athlete.registrationId === registrationId);
  const athlete = athletes[index] ?? athletes[0]!;
  const previous = athletes[index - 1];
  const next = athletes[index + 1];
  const provisionalEvaluationId =
    index === 2
      ? 'ffffffff-ffff-4fff-8fff-ffffffffffff'
      : index === 3
        ? 'fefefefe-fefe-4efe-8efe-fefefefefefe'
        : 'fdfdfdfd-fdfd-4dfd-8dfd-fdfdfdfdfdfd';
  const authoritativeEvaluationId =
    readAuthoritativeEvaluationId(registrationId, engine) ?? provisionalEvaluationId;

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
      <h1 className="sr-only">Evaluator scoring</h1>
      <AthletePager
        ariaLabel="Athlete navigation above scoring"
        currentIndex={index}
        nextHref={next ? `/${next.registrationId}` : null}
        previousHref={previous ? `/${previous.registrationId}` : null}
        total={athletes.length}
      />
      {index >= 2 ? (
        <SynchronizedEvaluationForm
          athlete={{
            ...athlete,
            identityMode: 'blind',
            divisionName: 'U13',
            sessionName: 'Morning skills',
            groupName: 'Blue',
          }}
          categories={categories}
          draftCacheKey={`fixture:${registrationId}`}
          initialDraft={{
            evaluationId: authoritativeEvaluationId,
            version: index >= 3 ? 1 : 0,
            state: 'draft',
            scores: [],
          }}
          noteTags={[]}
          onComplete={onComplete}
          serverSnapshotToken={randomUUID()}
          storageScope={{
            userId: '99999999-9999-4999-8999-999999999901',
            evaluatorId: '99999999-9999-4999-8999-999999999901',
            organizationId: '99999999-9999-4999-8999-999999999902',
            tryoutId: '99999999-9999-4999-8999-999999999903',
            sessionId: '99999999-9999-4999-8999-999999999904',
            registrationId,
            rubricVersionId: '99999999-9999-4999-8999-999999999905',
          }}
        />
      ) : (
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
          serverSnapshotToken={randomUUID()}
        />
      )}
      <AthletePager
        ariaLabel="Athlete navigation below scoring"
        currentIndex={index}
        nextHref={next ? `/${next.registrationId}` : null}
        previousHref={previous ? `/${previous.registrationId}` : null}
        total={athletes.length}
      />
    </main>
  );
}
