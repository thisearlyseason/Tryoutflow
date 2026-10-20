import type Decimal from 'decimal.js';

import { canonicalizeScore, ScoreDecimal, type CanonicalScore } from './decimal';

export type SupportedScaleMaximum = 5 | 10;
export type NormalizeScoreInput = Readonly<{ score: number; scaleMax: SupportedScaleMaximum }>;

export function assertIntegerScaleScore({ score, scaleMax }: NormalizeScoreInput): void {
  if (
    (scaleMax !== 5 && scaleMax !== 10) ||
    !Number.isSafeInteger(score) ||
    score < 1 ||
    score > scaleMax
  ) {
    throw new RangeError(
      'score must be an inclusive positive integer on the supported 1–5 or 1–10 scale',
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
