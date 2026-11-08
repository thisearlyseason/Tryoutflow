import type { Page, Request } from '@playwright/test';
import { expect } from '@playwright/test';

import type { BrowserErrorMonitor } from './network';

type SetupStep =
  'basics' | 'divisions' | 'sessions' | 'registration' | 'rubrics' | 'review' | 'publish';

/** Bound consumed navigation streams to the exact steps this scenario visits. */
export function observeDraftSetupNavigation(
  page: Page,
  monitor: BrowserErrorMonitor,
  organizationSlug: string,
  visits: Partial<Record<SetupStep, number>> = { divisions: 1, basics: 1 },
) {
  const base = new URL(`/app/${organizationSlug}/tryouts/`, page.url()).href;
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const steps = Object.keys(visits).join('|');
  const route = new RegExp(`^${escapedBase}[0-9a-f-]{36}/setup/(?:${steps})\\?_rsc=[^&#]+$`, 'u');
  const prefetched: string[] = [];
  const failed: Request[] = [];
  for (const [step, maxCount] of Object.entries(visits)) {
    monitor.allowOptionalRequestFailure({
      method: 'GET',
      url: new RegExp(`^${escapedBase}[0-9a-f-]{36}/setup/${step}\\?_rsc=[^&#]+$`, 'u'),
      headers: {
        rsc: '1',
        'next-router-prefetch': /^$/u,
        'next-router-segment-prefetch': /^$/u,
      },
      errorText: 'net::ERR_ABORTED',
      maxCount,
      label: `Consumed ${step} setup stream`,
    });
  }
  const request = (value: Request) => {
    const headers = value.headers();
    if (
      value.method() === 'GET' &&
      route.test(value.url()) &&
      headers.rsc === '1' &&
      (headers['next-router-prefetch'] !== undefined ||
        headers['next-router-segment-prefetch'] !== undefined)
    ) {
      prefetched.push(value.url());
    }
  };
  const requestFailed = (value: Request) => {
    if (value.method() === 'GET' && route.test(value.url())) failed.push(value);
  };
  const stop = () => {
    page.off('request', request);
    page.off('requestfailed', requestFailed);
    page.off('close', stop);
  };
  page.on('request', request);
  page.on('requestfailed', requestFailed);
  page.once('close', stop);
  return {
    async assertAndStop() {
      try {
        expect(prefetched, 'setup navigation never automatically prefetches').toEqual([]);
        for (const value of failed) {
          expect(
            (await value.response())?.status(),
            'a cancelled setup stream must have returned HTTP 200 before rendering',
          ).toBe(200);
        }
      } finally {
        stop();
      }
    },
  };
}
