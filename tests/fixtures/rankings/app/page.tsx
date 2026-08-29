import { RankingsWorkspace } from '../../../../src/modules/rankings/ui/rankings-workspace';
import type { RankingPage } from '../../../../src/modules/rankings/application/list-rankings';

export const fixtureRows: RankingPage = {
  page: 1,
  pageSize: 25,
  total: 2,
  totalPages: 1,
  generatedAt: '2026-08-29T12:00:00.000Z',
  rows: [
    {
      athleteId: '88888888-8888-4888-8888-888888888888',
      registrationId: '77777777-7777-4777-8777-777777777777',
      displayName: 'Athlete 12',
      tryoutNumber: 12,
      divisionId: '33333333-3333-4333-8333-333333333333',
      divisionName: 'U15',
      positionId: '22222222-2222-4222-8222-222222222221',
      positionName: 'Forward',
      rank: 1,
      isTied: true,
      overall: '90.0',
      priorityCategoryId: '55555555-5555-4555-8555-555555555555',
      priorityCategoryOverall: '90.0',
      completedEvaluators: 2,
      expectedEvaluators: 3,
      completionPercent: 67,
      scoreRange: ['80.0', '100.0'],
      categories: [
        {
          categoryId: '55555555-5555-4555-8555-555555555555',
          name: 'Skating',
          scaleMax: 5,
          normalizedAverage: '90.0',
        },
      ],
      sessions: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Skills' }],
      groups: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Blue' }],
      flags: ['needs_another_look'],
    },
    {
      athleteId: '88888888-8888-4888-8888-888888888889',
      registrationId: '77777777-7777-4777-8777-777777777778',
      displayName: 'Athlete 14',
      tryoutNumber: 14,
      divisionId: '33333333-3333-4333-8333-333333333333',
      divisionName: 'U15',
      positionId: '22222222-2222-4222-8222-222222222221',
      positionName: 'Forward',
      rank: 1,
      isTied: true,
      overall: '90.0',
      priorityCategoryId: '55555555-5555-4555-8555-555555555555',
      priorityCategoryOverall: '90.0',
      completedEvaluators: 2,
      expectedEvaluators: 2,
      completionPercent: 100,
      scoreRange: ['80.0', '100.0'],
      categories: [
        {
          categoryId: '55555555-5555-4555-8555-555555555555',
          name: 'Skating',
          scaleMax: 5,
          normalizedAverage: '90.0',
        },
      ],
      sessions: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Skills' }],
      groups: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Blue' }],
      flags: [],
    },
  ],
};

export default function Page() {
  return (
    <>
      <h1 className="mb-4">Tryout rankings</h1>
      <RankingsWorkspace compareHref="/compare" initial={fixtureRows} />
    </>
  );
}
