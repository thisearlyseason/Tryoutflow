import Decimal from 'decimal.js';

import type { OrganizationId } from '../../../lib/ids';

export type RubricScale = { min: 1; max: 5 | 10 };

export type RubricCategoryDraft = {
  id: string;
  name: string;
  sortOrder: number;
  weight: string | number;
  scale: { min: number; max: number };
  description?: string | null;
  guidance?: string | null;
  isPriority?: boolean;
};

export type RubricDraft = {
  id: string;
  organizationId: OrganizationId;
  tryoutId: string;
  name: string;
  categories: ReadonlyArray<RubricCategoryDraft>;
};

export type RubricVersion = RubricDraft & {
  versionNumber: number;
  status: 'draft' | 'published';
  publishedAt: Date | null;
};

export type RubricValidationError =
  'weights_must_total_100' | 'unsupported_scale' | 'duplicate_category_order' | 'invalid_category';

export function validateScale(scale: {
  min: number;
  max: number;
}): { ok: true } | { ok: false; code: 'unsupported_scale' } {
  return scale.min === 1 && (scale.max === 5 || scale.max === 10)
    ? { ok: true }
    : { ok: false, code: 'unsupported_scale' };
}

export function validateWeightTotal(
  categories: ReadonlyArray<{ weight: string | number }>,
): { ok: true } | { ok: false; code: 'weights_must_total_100' } {
  try {
    const total = categories.reduce(
      (sum, category) => sum.plus(new Decimal(category.weight)),
      new Decimal(0),
    );
    return total.equals(100) ? { ok: true } : { ok: false, code: 'weights_must_total_100' };
  } catch {
    return { ok: false, code: 'weights_must_total_100' };
  }
}

export function createRubricDraft(
  input: RubricDraft,
): { ok: true; value: RubricDraft } | { ok: false; code: RubricValidationError } {
  const order = new Set<number>();
  for (const category of input.categories) {
    if (
      !category.id ||
      !category.name.trim() ||
      !Number.isInteger(category.sortOrder) ||
      category.sortOrder < 0 ||
      order.has(category.sortOrder)
    ) {
      return {
        ok: false,
        code: order.has(category.sortOrder) ? 'duplicate_category_order' : 'invalid_category',
      };
    }
    if (!validateScale(category.scale).ok) return { ok: false, code: 'unsupported_scale' };
    try {
      if (!new Decimal(category.weight).greaterThan(0))
        return { ok: false, code: 'invalid_category' };
    } catch {
      return { ok: false, code: 'invalid_category' };
    }
    order.add(category.sortOrder);
  }

  const validWeight = validateWeightTotal(input.categories);
  if (!validWeight.ok) return validWeight;

  return {
    ok: true,
    value: {
      ...input,
      categories: [...input.categories].sort((left, right) => left.sortOrder - right.sortOrder),
    },
  };
}
