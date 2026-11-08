import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { getTrustedRequestOrigin } from '../../../src/lib/request-origin';

const preview = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_APP_URL: 'https://www.tryout.agency',
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  VERCEL_PROJECT_ID: 'prj_3oAxXhX98AXJ2mEWYi56n5iZneWI',
  VERCEL_URL: 'tryout-3wpmoi4oq-tylers-projects-5b59182e.vercel.app',
};
const request = new NextRequest('http://internal:3000/participant', {
  headers: {
    host: 'attacker.example',
    'x-forwarded-host': 'attacker.example',
    'x-forwarded-proto': 'http',
  },
});

describe('Vercel preview auth origin', () => {
  it('retains the explicitly approved stable QA canonical host on this project preview', () => {
    expect(
      getTrustedRequestOrigin(request, {
        ...preview,
        NEXT_PUBLIC_APP_URL: 'https://tryout-ux-qa-tylers-projects-5b59182e.vercel.app',
      }),
    ).toBe('https://tryout-ux-qa-tylers-projects-5b59182e.vercel.app');
  });

  it('does not accept arbitrary preview canonical hosts', () => {
    expect(
      getTrustedRequestOrigin(request, {
        ...preview,
        NEXT_PUBLIC_APP_URL: 'https://arbitrary.example',
      }),
    ).toBe('https://tryout-3wpmoi4oq-tylers-projects-5b59182e.vercel.app');
  });

  it('keeps protected redirects on the provider-assigned preview despite forged headers', () => {
    expect(getTrustedRequestOrigin(request, preview)).toBe(
      'https://tryout-3wpmoi4oq-tylers-projects-5b59182e.vercel.app',
    );
  });

  it.each([
    ['VERCEL', undefined],
    ['VERCEL', 'true'],
    ['VERCEL_ENV', 'production'],
    ['VERCEL_ENV', 'development'],
    ['VERCEL_PROJECT_ID', undefined],
    ['VERCEL_PROJECT_ID', 'prj_other'],
    ['VERCEL_URL', undefined],
    ['VERCEL_URL', 'attacker.example'],
    ['VERCEL_URL', 'otherproject-123.vercel.app'],
    ['VERCEL_URL', `tryout-${'a'.repeat(57)}.vercel.app`],
    ['VERCEL_URL', 'tryout-.vercel.app'],
    ['VERCEL_URL', 'tryout-branch-.vercel.app'],
    ['VERCEL_URL', 'tryout.vercel.app.attacker.example'],
    ['VERCEL_URL', 'https://tryout.vercel.app'],
    ['VERCEL_URL', 'owner:secret@tryout.vercel.app'],
    ['VERCEL_URL', 'tryout.vercel.app:8443'],
    ['VERCEL_URL', 'tryout.vercel.app/path'],
    ['VERCEL_URL', 'tryout.vercel.app?foo=bar'],
    ['VERCEL_URL', 'tryout.vercel.app#fragment'],
    ['VERCEL_URL', 'tryout.vercel.app,attacker.example'],
  ])('uses the canonical origin when %s is %s', (key, value) => {
    expect(getTrustedRequestOrigin(request, { ...preview, [key]: value })).toBe(
      'https://www.tryout.agency',
    );
  });

  it('still rejects missing canonical configuration on a preview', () => {
    expect(() =>
      getTrustedRequestOrigin(request, { ...preview, NEXT_PUBLIC_APP_URL: undefined }),
    ).toThrow(/canonical origin/u);
  });
});
