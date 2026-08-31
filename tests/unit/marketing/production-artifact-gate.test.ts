// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { assertMarketingProductionResponse } from '../../../scripts/verify-marketing-production.mjs';

describe('marketing production artifact gate', () => {
  it('rejects a placeholder or wrong canonical origin in a rendered marketing response', () => {
    expect(() =>
      assertMarketingProductionResponse({
        body: '<link rel="canonical" href="https://tryoutflow.example/pricing">',
        path: '/pricing',
        status: 200,
      }),
    ).toThrow(/canonical/i);
  });

  it('rejects a non-static or non-200 response before accepting canonical metadata', () => {
    expect(() =>
      assertMarketingProductionResponse({
        body: '<link rel="canonical" href="https://marketing.tryoutflow.test/pricing">',
        path: '/pricing',
        status: 404,
      }),
    ).toThrow(/status/i);
  });
});
