import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ offerings: { current: null as unknown }, platform: 'ios' }));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
}));
vi.mock('react-native-purchases', () => ({
  default: { getOfferings: async () => state.offerings },
  PURCHASES_ERROR_CODE: {},
}));

import { getOfferings } from '../src/native-billing';

beforeEach(() => {
  state.offerings.current = null;
  state.platform = 'ios';
});

test('requires the matching Google base plan identifier', async () => {
  state.platform = 'android';
  const expected = {
    identifier: 'pro_monthly',
    product: { identifier: 'agency.tryout.pro:monthly' },
  };
  state.offerings.current = {
    identifier: 'tryoutflow_v1',
    availablePackages: [
      expected,
      { identifier: 'pro_annual', product: { identifier: 'agency.tryout.pro.monthly' } },
    ],
  };
  await expect(getOfferings()).resolves.toEqual([expected]);
});

test('rejects an unexpected current offering before presenting products', async () => {
  state.offerings.current = {
    identifier: 'another_product',
    availablePackages: [{ identifier: 'pro_monthly', product: { identifier: 'other.pro' } }],
  };
  await expect(getOfferings()).rejects.toThrow('TryOutFlow purchases are temporarily unavailable.');
});

test('only presents packages mapped to TryOutFlow Apple product IDs', async () => {
  const expected = {
    identifier: 'pro_monthly',
    product: { identifier: 'agency.tryout.pro.monthly' },
  };
  state.offerings.current = {
    identifier: 'tryoutflow_v1',
    availablePackages: [
      expected,
      { identifier: 'organization_monthly', product: { identifier: 'other.organization.monthly' } },
      { identifier: 'unknown', product: { identifier: 'agency.tryout.pro.annual' } },
    ],
  };
  await expect(getOfferings()).resolves.toEqual([expected]);
});
