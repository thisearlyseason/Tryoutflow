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
    ).toThrow(/publicly routable HTTPS origin/i);
  });

  it.each([
    ['case-folded localhost with trailing dot', 'https://LOCALHOST.'],
    ['localhost subdomain with trailing dot', 'https://auth.LOCALHOST.'],
    ['the end of IPv4 loopback', 'https://127.255.255.255'],
    ['unspecified IPv4', 'https://0.0.0.0'],
    ['another 0/8 address', 'https://0.1.2.3'],
    ['shared carrier address space', 'https://100.64.0.1'],
    ['RFC1918 10/8', 'https://10.0.0.1'],
    ['RFC1918 172.16/12', 'https://172.31.255.255'],
    ['RFC1918 192.168/16', 'https://192.168.1.1'],
    ['IPv4 link-local', 'https://169.254.1.1'],
    ['IPv4 protocol assignment', 'https://192.0.0.1'],
    ['IPv4 documentation space', 'https://192.0.2.1'],
    ['IPv4 benchmark space', 'https://198.18.0.1'],
    ['another IPv4 documentation space', 'https://198.51.100.1'],
    ['the final IPv4 documentation space', 'https://203.0.113.1'],
    ['IPv4 multicast space', 'https://224.0.0.1'],
    ['IPv6 unspecified', 'https://[::]'],
    ['IPv6 loopback', 'https://[::1]'],
    ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]'],
    ['IPv4-compatible IPv6 loopback', 'https://[::127.0.0.1]'],
    ['IPv6 unique local address', 'https://[fd12::1]'],
    ['IPv6 link-local address', 'https://[fe80::1]'],
    ['IPv6 documentation space', 'https://[2001:db8::1]'],
    ['IPv6 multicast space', 'https://[ff02::1]'],
    ['a decimal IPv4 loopback spelling', 'https://2130706433'],
    ['a hexadecimal IPv4 loopback spelling', 'https://0x7f000001'],
    ['an octal IPv4 loopback spelling', 'https://0177.0.0.1'],
    ['a shortened IPv4 loopback spelling', 'https://127.1'],
  ])('rejects production origin using %s', (_label, origin) => {
    expect(() =>
      getPublicAppOrigin({ NEXT_PUBLIC_APP_URL: origin, NODE_ENV: 'production' }),
    ).toThrow(/publicly routable HTTPS origin/i);
  });

  it.each([
    ['a public domain with a nondefault port', 'https://PUBLIC.tryoutflow.test:8443'],
    ['a public dotted domain', 'https://public.tryoutflow.test.'],
    ['a public IPv4 address', 'https://8.8.8.8'],
    ['a public bracketed IPv6 address', 'https://[2606:4700:4700::1111]'],
  ])('accepts production origin using %s', (_label, origin) => {
    expect(getPublicAppOrigin({ NEXT_PUBLIC_APP_URL: origin, NODE_ENV: 'production' })).toBe(
      new URL(origin).origin,
    );
  });
});
