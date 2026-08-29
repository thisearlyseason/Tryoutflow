import type Decimal from 'decimal.js';

import { canonicalizeScore, MAX_SCALE_MAX, ScoreDecimal, type CanonicalScore } from './decimal';

export type NormalizeScoreInput = Readonly<{ score: number; scaleMax: number }>;

export function assertIntegerScaleScore({ score, scaleMax }: NormalizeScoreInput): void {
  if (
    !Number.isSafeInteger(scaleMax) ||
    scaleMax < 1 ||
    scaleMax > MAX_SCALE_MAX ||
    !Number.isSafeInteger(score) ||
    score < 1 ||
    score > scaleMax
  ) {
    throw new RangeError(
      'score must be an inclusive positive integer within a bounded integer scale',
    );
  }
}

export function exactNormalizedScore(input: NormalizeScoreInput): Decimal {
  assertIntegerScaleScore(input);
  return new ScoreDecimal(input.score).dividedBy(input.scaleMax).times(100);
}

export function normalizeScore(input: NormalizeScoreInput): CanonicalScore {
  return canonicalizeScore(exactNormalizedScore(input));
}
