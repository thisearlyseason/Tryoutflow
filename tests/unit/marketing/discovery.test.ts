import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  publicIndexingEnabled,
  PUBLIC_ORIGIN,
  DISCOVERY_PATHS,
} from '../../../src/modules/marketing/content/discovery';
import { marketingMetadata } from '../../../src/modules/marketing/content/metadata';
import sitemap from '../../../src/app/sitemap';
import robots from '../../../src/app/robots';

afterEach(() => vi.unstubAllEnvs());
describe('public discovery boundaries', () => {
  it('indexes production only and never uses preview origins as canonicals', () => {
    for (const environment of ['preview', 'development']) {
      vi.stubEnv('VERCEL_ENV', environment);
      expect(publicIndexingEnabled()).toBe(false);
      expect(sitemap()).toEqual([]);
      expect(
        marketingMetadata({ path: '/features', title: 'Features', description: 'Workflow' }),
      ).toMatchObject({
        alternates: { canonical: `${PUBLIC_ORIGIN}/features` },
        robots: { index: false },
      });
    }
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(sitemap().map((x) => x.url)).toEqual(
      DISCOVERY_PATHS.map((x) => new URL(x, PUBLIC_ORIGIN).href),
    );
    expect(
      marketingMetadata({ path: '/delete-account', title: 'Delete', description: 'Account' })
        .robots,
    ).toMatchObject({ index: false });
    expect(robots().rules).toEqual({ userAgent: '*', allow: '/' });
    expect(robots().sitemap).toBe(`${PUBLIC_ORIGIN}/sitemap.xml`);
  });
  it('does not publish test and localhost installations', () => {
    expect(
      publicIndexingEnabled({
        NODE_ENV: 'production',
        NEXT_PUBLIC_APP_URL: 'https://preview.example.com',
      }),
    ).toBe(false);
    expect(
      publicIndexingEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: PUBLIC_ORIGIN }),
    ).toBe(true);
  });
});
