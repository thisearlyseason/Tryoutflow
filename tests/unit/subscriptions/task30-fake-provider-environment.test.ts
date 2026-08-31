import { describe, expect, it } from 'vitest';

import { task30FakeBillingProviderOrigin } from '../../../src/infrastructure/billing/task30-fake-provider-environment';

const exactEnvironment = {
  NEXT_PUBLIC_APP_URL: 'https://task30.e2e.example.test',
  TASK30_LOCAL_REQUEST_ORIGIN: 'http://127.0.0.1:3112',
  TRYOUTFLOW_FAKE_BILLING_PROVIDER: 'true',
  TRYOUTFLOW_SERVER_TEST_ENV: 'task30-playwright',
};

describe('Task 30 fake billing provider environment', () => {
  it('accepts only the exact deterministic server-test boundary', () => {
    expect(task30FakeBillingProviderOrigin(exactEnvironment)).toBe('http://127.0.0.1:3112');
  });

  it.each([
    ['missing test mode', { ...exactEnvironment, TRYOUTFLOW_SERVER_TEST_ENV: undefined }],
    ['different test mode', { ...exactEnvironment, TRYOUTFLOW_SERVER_TEST_ENV: 'other' }],
    ['fake provider disabled', { ...exactEnvironment, TRYOUTFLOW_FAKE_BILLING_PROVIDER: 'false' }],
    [
      'different public origin',
      { ...exactEnvironment, NEXT_PUBLIC_APP_URL: 'https://example.test' },
    ],
    [
      'different local port',
      { ...exactEnvironment, TASK30_LOCAL_REQUEST_ORIGIN: 'http://127.0.0.1:3113' },
    ],
    [
      'non-loopback local origin',
      { ...exactEnvironment, TASK30_LOCAL_REQUEST_ORIGIN: 'http://192.0.2.1:3112' },
    ],
  ])('rejects %s', (_label, environment) => {
    expect(task30FakeBillingProviderOrigin(environment)).toBeNull();
  });
});
