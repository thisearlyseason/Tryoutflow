import { parseOrganizationId, parseUserId } from '../../src/lib/ids';
import {
  previewAthleteImport,
  type AthleteImportPreview,
} from '../../src/modules/registration/application/preview-athlete-import';
import { describe, it, expect, vi } from 'vitest';
import { validateTryoutBasics } from '../../src/modules/tryouts/application/validate-tryout-basics';
import { createTryout } from '../../src/modules/tryouts/application/create-tryout';
import { createRubricDraft } from '../../src/modules/rubrics/domain/rubric';
import { sportTemplates, summarizeResults } from '../../src/modules/talent/domain/performance';
import type { AuthorizationContext } from '../../src/modules/organizations/application/capabilities';
import type { TryoutGateway } from '../../src/modules/tryouts/domain/tryout';
const organizationId = parseOrganizationId('11111111-1111-4111-8111-111111111111');
const authorization = {
  organizationId,
  userId: parseUserId('22222222-2222-4222-8222-222222222222'),
  organizationRole: 'owner',
  membershipStatus: 'active',
  assignments: [],
} satisfies AuthorizationContext;
const sports = [
  'Hockey',
  'Ringette',
  'Soccer',
  'Basketball',
  'Volleyball',
  'Baseball',
  'Softball',
  'Football',
  'Lacrosse',
  'Adaptive multisport',
];
describe.each(sports)('%s configurable workflow', (sport) => {
  it('previews valid/invalid athlete rows in the same organization without sport-specific import assumptions', async () => {
    const r = await previewAthleteImport(
      {
        organizationId,
        actor: authorization,
        content: `First,Last,DOB\nQA,${sport},2013-05-01\nQA,${sport},2023-02-29`,
        mapping: { givenName: 'First', familyName: 'Last', birthDate: 'DOB' },
      },
      {
        findExistingAthletes: async () => [],
        savePreview: async (p: Omit<AthleteImportPreview, 'id'>) => ({ ...p, id: 'local-preview' }),
      },
    );
    expect(r.organizationId).toBe(organizationId);
    expect(r.rows).toMatchObject([
      { status: 'valid', athlete: { familyName: sport } },
      { status: 'invalid', errors: ['birth_date_invalid'] },
    ]);
  });
  it('preserves sport through bounded basics validation', () => {
    expect(
      validateTryoutBasics({
        name: 'Local QA',
        sport,
        timezone: 'UTC',
        registrationStartsAt: '2026-10-01T09:00',
        registrationEndsAt: '2026-10-30T18:30',
      }),
    ).toMatchObject({ ok: true, value: { sport } });
  });
  it('creates owner draft without sport substitution', async () => {
    const createDraft = vi.fn(async (input: Parameters<TryoutGateway['createDraft']>[0]) => ({
      id: '33333333-3333-4333-8333-333333333333',
      ...input,
    }));
    const gateway = { createDraft, transitionLifecycle: vi.fn() } as TryoutGateway;
    const r = await createTryout(
      { organizationId, name: 'Local QA', sport, newSeasonName: '2026 QA', timezone: 'UTC' },
      { authorization },
      { gateway },
    );
    expect(r).toMatchObject({ ok: true, value: { sport, status: 'draft' } });
    expect(createDraft).toHaveBeenCalledOnce();
  });
  it('keeps evaluator draft-creation privileges denied', async () => {
    const createDraft = vi.fn();
    const gateway = { createDraft, transitionLifecycle: vi.fn() } as TryoutGateway;
    const r = await createTryout(
      { organizationId, name: 'Local QA', sport, newSeasonName: '2026 QA', timezone: 'UTC' },
      {
        authorization: {
          ...authorization,
          organizationRole: 'member',
          assignments: [
            {
              role: 'evaluator',
              scope: { kind: 'tryout', tryoutId: '33333333-3333-4333-8333-333333333333' },
            },
          ],
        },
      },
      { gateway },
    );
    expect(r).toEqual({ ok: false, error: { code: 'forbidden' } });
    expect(createDraft).not.toHaveBeenCalled();
  });
  it('retains custom criterion names and mixed5/10scales with100%weights', () => {
    const r = createRubricDraft({
      id: 'r',
      organizationId: authorization.organizationId,
      tryoutId: 't',
      name: sport + ' rubric',
      categories: [
        {
          id: 'a',
          name: sport + ' coordination',
          sortOrder: 1,
          weight: '40.00',
          scale: { min: 1, max: 5 },
        },
        {
          id: 'b',
          name: sport + ' technique',
          sortOrder: 2,
          weight: '60.00',
          scale: { min: 1, max: 10 },
        },
      ],
    });
    expect(r).toMatchObject({
      ok: true,
      value: { categories: [{ name: sport + ' coordination' }, { name: sport + ' technique' }] },
    });
  });
});
describe.each(sportTemplates)('$sport built-in metric: $name', (preset) => {
  it('ranks valid performance by protocol direction and excludes invalid attempts', () => {
    const metric = { ...preset, id: 'm' };
    const base = {
      metric_id: 'm',
      status: 'valid',
      measured_at: '2026-10-01T09:00:00Z',
      trial: 1,
      verified: true,
    };
    const rows = summarizeResults(metric, [
      { ...base, athlete_id: 'a', value: 4 },
      { ...base, athlete_id: 'b', value: 8 },
      { ...base, athlete_id: 'c', value: 99, status: 'invalid' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.athleteId).toBe(preset.direction === 'lower' ? 'a' : 'b');
    expect(rows[0]?.rank).toBe(1);
    expect(preset.protocol.length).toBeGreaterThan(10);
  });
});
