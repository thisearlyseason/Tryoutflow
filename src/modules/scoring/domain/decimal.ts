import Decimal from 'decimal.js';

/** Score arithmetic is decimal and rounds half-up only at the four-place storage boundary. */
export const ScoreDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

export const SCORE_DECIMAL_PLACES = 4;
export const MAX_INPUT_DECIMAL_PLACES = 8;
export const MAX_CATEGORY_COUNT = 100;
export const MAX_EVALUATION_COUNT = 1000;
export const MAX_ATHLETE_COUNT = 10_000;
export type CanonicalScore = string;

const MAX_DECIMAL_INTEGER_DIGITS = 3;
const MAX_PLAIN_DECIMAL_LENGTH = MAX_DECIMAL_INTEGER_DIGITS + 1 + MAX_INPUT_DECIMAL_PLACES;
const PLAIN_DECIMAL = /^(?:0|[1-9]\d{0,2})(?:\.(\d+))?$/;
const WEIGHT_DECIMAL = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const CANONICAL_SCORE = /^(?:0|[1-9]\d{0,2})\.\d{4}$/;

export function parseBoundedDecimal(value: string, label: string): Decimal {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a decimal string`);
  if (value.length === 0 || value.length > MAX_PLAIN_DECIMAL_LENGTH) {
    throw new RangeError(`${label} is outside its supported decimal bounds`);
  }
  const match = PLAIN_DECIMAL.exec(value);
  if (!match || (match[1]?.length ?? 0) > MAX_INPUT_DECIMAL_PLACES) {
    throw new RangeError(`${label} must be a plain non-negative decimal with at most eight places`);
  }
  const decimal = new ScoreDecimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) throw new RangeError(`${label} is invalid`);
  return decimal;
}

/** Matches the database rubric weight contract: numeric(5,2), canonical plain input. */
export function parseWeightDecimal(value: string, label = 'category weight'): Decimal {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a decimal string`);
  if (value.length === 0 || value.length > 6 || !WEIGHT_DECIMAL.test(value)) {
    throw new RangeError(`${label} must be a canonical numeric(5,2) decimal`);
  }
  const decimal = new ScoreDecimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) throw new RangeError(`${label} is invalid`);
  return decimal;
}

export function parseCanonicalScore(value: string, label = 'score'): Decimal {
  if (typeof value !== 'string' || value.length > 8 || !CANONICAL_SCORE.test(value)) {
    throw new RangeError(`${label} must be a canonical four-decimal score`);
  }
  const decimal = new ScoreDecimal(value);
  if (!decimal.isFinite() || decimal.isNegative() || decimal.greaterThan(100)) {
    throw new RangeError(`${label} must be between 0.0000 and 100.0000`);
  }
  return decimal;
}

export function canonicalizeScore(value: Decimal): CanonicalScore {
  if (!value.isFinite() || value.isNegative() || value.greaterThan(100)) {
    throw new RangeError('derived score must be between zero and one hundred');
  }
  const canonical = value
    .toDecimalPlaces(SCORE_DECIMAL_PLACES, ScoreDecimal.ROUND_HALF_UP)
    .toFixed(SCORE_DECIMAL_PLACES);
  return canonical === '-0.0000' ? '0.0000' : canonical;
}

export function assertBoundedCollection(
  length: number,
  maximum: number,
  label: string,
  allowEmpty = false,
): void {
  if (!Number.isSafeInteger(length) || length > maximum || (!allowEmpty && length === 0)) {
    throw new RangeError(`${label} cardinality is outside its supported bounds`);
  }
}

export function assertOpaqueId(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value
  ) {
    throw new RangeError(`${label} must be a bounded non-empty identifier`);
  }
}
