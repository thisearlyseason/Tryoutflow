import { describe, expect, it } from 'vitest';

import { getPublicAppOrigin } from '../../../src/lib/env';

describe('public app origin', () => {
  it('returns the configured absolute origin without changing its host or port', () => {
    expect(
      getPublicAppOrigin({
        NEXT_PUBLIC_APP_URL: 'https://marketing.tryoutflow.test:8443',
        NODE_ENV: 'production',
      }),
    ).toBe('https://marketing.tryoutflow.test:8443');
  });

  it.each([
    ['a missing value', {}, /NEXT_PUBLIC_APP_URL is required/i],
    ['a malformed URL', { NEXT_PUBLIC_APP_URL: 'tryoutflow.test' }, /valid absolute URL/i],
    [
      'embedded credentials',
      { NEXT_PUBLIC_APP_URL: 'https://owner:secret@tryoutflow.test' },
      /credentials/i,
    ],
    [
      'a path',
      { NEXT_PUBLIC_APP_URL: 'https://tryoutflow.test/marketing' },
      /path, query, or fragment/i,
    ],
    [
      'a query',
      { NEXT_PUBLIC_APP_URL: 'https://tryoutflow.test?campaign=fall' },
      /path, query, or fragment/i,
    ],
    [
      'a fragment',
      { NEXT_PUBLIC_APP_URL: 'https://tryoutflow.test#privacy' },
      /path, query, or fragment/i,
    ],
    [
      'insecure non-localhost HTTP',
      { NEXT_PUBLIC_APP_URL: 'http://tryoutflow.test' },
      /must be secure/i,
    ],
  ])('rejects %s', (_label, environment, message) => {
    expect(() => getPublicAppOrigin(environment)).toThrow(message);
  });

  it.each([
    ['HTTP localhost', 'http://localhost:3000'],
    ['HTTPS localhost', 'https://localhost:3000'],
    ['HTTP loopback', 'http://127.0.0.1:3000'],
  ])('allows explicit %s outside production', (_label, origin) => {
    expect(getPublicAppOrigin({ NEXT_PUBLIC_APP_URL: origin, NODE_ENV: 'test' })).toBe(origin);
  });

  it.each([
    ['HTTP localhost', 'http://localhost:3000'],
    ['HTTPS localhost', 'https://localhost:3000'],
    ['HTTP public origin', 'http://tryoutflow.test'],
  ])('rejects %s for production', (_label, origin) => {
    expect(() =>
      getPublicAppOrigin({ NEXT_PUBLIC_APP_URL: origin, NODE_ENV: 'production' }),
    ).toThrow(/secure non-localhost HTTPS origin/i);
  });
});
