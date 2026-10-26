// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createReaperRetryPolicy } from '../../../scripts/lib/integration-reaper-policy.mjs';

describe('integration reaper retry policy', () => {
  it('bounds attempts and applies capped exponential backoff before quiescing', () => {
    const policy = createReaperRetryPolicy();

    expect(Array.from({ length: 6 }, () => policy.next())).toEqual([
      { attempt: 1, delayMilliseconds: 0, exhausted: false },
      { attempt: 2, delayMilliseconds: 100, exhausted: false },
      { attempt: 3, delayMilliseconds: 200, exhausted: false },
      { attempt: 4, delayMilliseconds: 400, exhausted: false },
      { attempt: 5, delayMilliseconds: 800, exhausted: false },
      { attempt: 5, delayMilliseconds: 0, exhausted: true },
    ]);
  });
});
