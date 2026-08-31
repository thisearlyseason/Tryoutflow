import { expect, test } from '@playwright/test';

test('intentional failure exposes the canonical release retry count', () => {
  expect('release').toBe('retry-disabled');
});
