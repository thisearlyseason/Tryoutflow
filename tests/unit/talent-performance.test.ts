import { ageAtCutoff, ageEligibility } from '../../src/modules/talent/domain/eligibility';
import { describe, it, expect } from 'vitest';
import { summarizeResults, type Metric, type Result } from '@/modules/talent/domain/performance';
import {
  resultSchema,
  recordSchema,
  stationSchema,
  feeSchema,
} from '@/modules/talent/domain/schemas';
import { videoMoment } from '@/modules/talent/domain/video';
import { recordDefaults } from '@/modules/talent/ui/fields';
const metric: Metric = {
  id: 'm',
  name: 'Sprint',
  unit: 's',
  direction: 'lower',
  aggregation: 'best',
  protocol: '20 m electronic',
  sport: 'Hockey',
};
const result = (athlete_id: string, value: number | null, extra: Partial<Result> = {}): Result => ({
  athlete_id,
  value,
  metric_id: 'm',
  status: 'valid',
  trial: 1,
  measured_at: '2026-09-01T12:00:00Z',
  verified: true,
  ...extra,
});
describe('scouting performance decisions', () => {
  it('ranks lower times ahead and preserves genuine ties', () => {
    const r = summarizeResults(metric, [
      result('a', 4),
      result('b', 4),
      result('c', 5),
      result('a', 6),
    ]);
    expect(r.map((x) => [x.athleteId, x.rank, x.value])).toEqual([
      ['a', 1, 4],
      ['b', 1, 4],
      ['c', 3, 5],
    ]);
    expect(r[0]?.attempts).toBe(2);
  });
  it('does not rank missing invalid or nonfinite attempts as zero', () => {
    expect(
      summarizeResults(metric, [
        result('a', null, { status: 'not_observed' }),
        result('b', 0, { status: 'invalid' }),
        result('c', Infinity),
        result('d', NaN),
      ]),
    ).toEqual([]);
  });
  it('uses weighted successes and attempts for mean percentages', () => {
    const r = summarizeResults(
      { ...metric, value_kind: 'ratio', direction: 'higher', aggregation: 'mean' },
      [
        result('a', 100, { numerator: 1, denominator: 1 }),
        result('a', 50, { numerator: 5, denominator: 10, trial: 2 }),
      ],
    );
    expect(r[0]?.value).toBeCloseTo(600 / 11);
  });
  it('uses actual chronology and trial number for latest', () => {
    expect(
      summarizeResults({ ...metric, aggregation: 'latest' }, [
        result('a', 8, { trial: 3 }),
        result('a', 4, { trial: 1 }),
        result('a', 5, { measured_at: '2026-08-01T12:00:00Z' }),
      ])[0]?.value,
    ).toBe(8);
  });
  it('suppresses small cohort percentiles and descriptive rankings', () => {
    expect(summarizeResults(metric, [result('a', 4)])[0]?.percentile).toBeNull();
    expect(
      summarizeResults({ ...metric, direction: 'neutral' }, [result('a', 4)])[0]?.rank,
    ).toBeNull();
  });
  it('uses mid-rank percentiles for tied peers', () => {
    const r = summarizeResults(metric, [
      result('a', 4),
      result('b', 4),
      result('c', 5),
      result('d', 6),
      result('e', 7),
    ]);
    expect(r[0]?.percentile).toBe(80);
    expect(r[4]?.percentile).toBe(10);
  });
  it('retains an unverified indication for mixed sources', () => {
    expect(
      summarizeResults(metric, [result('a', 4), result('a', 5, { verified: false })])[0]?.verified,
    ).toBe(false);
  });
});
const uuid = '51000000-0000-4000-8000-000000000001';
const valid = {
  athlete_id: uuid,
  metric_id: uuid,
  session_id: '',
  value: '4.3',
  numerator: '',
  denominator: '',
  status: 'valid',
  trial: 1,
  measured_at: '2026-01-01T12:00:00Z',
  source: 'Timing gate A',
  verified: true,
  note: '',
};
describe('scouting write contracts', () => {
  it('normalizes numeric input without converting missing results to zero', () => {
    expect(resultSchema.parse(valid).value).toBe(4.3);
    expect(
      resultSchema.parse({ ...valid, status: 'did_not_participate', value: 0 }).value,
    ).toBeNull();
  });
  it('rejects incomplete valid results, future times and impossible ratios', () => {
    expect(resultSchema.safeParse({ ...valid, value: '' }).success).toBe(false);
    expect(resultSchema.safeParse({ ...valid, measured_at: '2099-01-01T12:00:00Z' }).success).toBe(
      false,
    );
    expect(
      resultSchema.safeParse({ ...valid, value: '', numerator: 4, denominator: 3 }).success,
    ).toBe(false);
  });
  it('requires evidence for video records and ordered clip bounds', () => {
    const r = { ...recordDefaults, athlete_id: uuid, kind: 'video', title: 'QA clip' };
    expect(recordSchema.safeParse(r).success).toBe(false);
    expect(
      recordSchema.safeParse({
        ...r,
        video_url: 'https://example.test/video.mp4',
        start_seconds: 20,
        end_seconds: 10,
      }).success,
    ).toBe(false);
    expect(
      recordSchema.safeParse({ ...r, video_url: 'https://user:secret@example.test/video.mp4' })
        .success,
    ).toBe(false);
  });
  it('rejects a backwards rotation', () => {
    expect(
      stationSchema.safeParse({
        tryout_id: uuid,
        session_id: uuid,
        name: 'Skills',
        status: 'active',
        location: '',
        instructions: '',
        starts_at: '2026-01-02T12:00:00Z',
        ends_at: '2026-01-02T11:00:00Z',
        capacity: 12,
        evaluator_user_id: '',
        group_label: 'Blue',
      }).success,
    ).toBe(false);
  });
  it('rejects over-refunds and overpayments in the event ledger', () => {
    const f = {
      tryout_id: uuid,
      athlete_id: uuid,
      description: 'Tryout',
      currency: 'CAD',
      amount_cents: 7500,
      paid_cents: 5000,
      refunded_cents: 0,
      waived_cents: 0,
      due_on: '',
      reference: 'receipt 1',
      note: '',
    };
    expect(feeSchema.safeParse({ ...f, refunded_cents: 6000 }).success).toBe(false);
    expect(feeSchema.safeParse({ ...f, paid_cents: 8000 }).success).toBe(false);
    expect(feeSchema.safeParse(f).success).toBe(true);
  });
});
describe('timestamped evidence links', () => {
  it('preserves provider URLs and adds supported time markers', () => {
    expect(videoMoment('https://youtu.be/abc', 42, null)).toBe('https://youtu.be/abc?t=42s');
    expect(videoMoment('https://example.test/video.mp4?signature=abc', 2, 5)).toBe(
      'https://example.test/video.mp4?signature=abc#t=2,5',
    );
    expect(videoMoment('https://example.test/opaque-link', 2, 5)).toBe(
      'https://example.test/opaque-link',
    );
  });
  it('rejects executable and credential-bearing links', () => {
    expect(() => videoMoment('javascript:alert(1)', null, null)).toThrow();
    expect(() => videoMoment('https://u:p@example.test/', null, null)).toThrow();
  });
});

describe('explicit eligibility cutoff', () => {
  it('changes age on the birthday without using local timezone', () => {
    expect(ageAtCutoff('2010-09-15', '2026-09-14')).toBe(15);
    expect(ageAtCutoff('2010-09-15', '2026-09-15')).toBe(16);
  });
  it('keeps unknown birth dates and missing rules distinct from passing', () => {
    expect(ageEligibility(null, '2026-09-15', null, 15).status).toBe(
      'Birth date required for review',
    );
    expect(ageEligibility('2010-09-15', '2026-09-15', null, null).status).toBe(
      'No age rule configured',
    );
    expect(ageEligibility('2010-09-15', '2026-09-15', null, 15).status).toBe(
      'Outside configured age range',
    );
  });
  it('accepts a valid active station interval', () => {
    expect(
      stationSchema.safeParse({
        tryout_id: uuid,
        session_id: uuid,
        status: 'active',
        name: 'Skills',
        location: '',
        instructions: '',
        starts_at: '2026-01-02T11:00:00Z',
        ends_at: '2026-01-02T12:00:00Z',
        capacity: 12,
        evaluator_user_id: '',
        group_label: 'Blue',
      }).success,
    ).toBe(true);
  });
});
