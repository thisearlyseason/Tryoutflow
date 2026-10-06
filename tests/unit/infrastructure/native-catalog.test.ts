import { describe, expect, it } from 'vitest';

import { nativeProductIdentifier } from '../../../scripts/lib/native-catalog';

describe('native offering product identity', () => {
  it('distinguishes Google subscription base plans returned as separate fields', () => {
    const product = { platform_product_identifier: 'agency.tryout.pro' };
    expect(
      nativeProductIdentifier('google', {
        ...product,
        platform_product_plan_identifier: 'monthly',
      }),
    ).toBe('agency.tryout.pro:monthly');
    expect(
      nativeProductIdentifier('google', { ...product, platform_product_plan_identifier: 'annual' }),
    ).toBe('agency.tryout.pro:annual');
  });

  it('preserves Google consumables without a base plan and Apple product identifiers', () => {
    expect(
      nativeProductIdentifier('google', {
        platform_product_identifier: 'agency.tryout.single_tryout_pro',
      }),
    ).toBe('agency.tryout.single_tryout_pro');
    expect(
      nativeProductIdentifier('apple', {
        platform_product_identifier: 'agency.tryout.pro.monthly',
      }),
    ).toBe('agency.tryout.pro.monthly');
  });
});
